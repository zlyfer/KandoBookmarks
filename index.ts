import fs from "fs";
import path from "path";

const browserProfilePath = "C:\\Users\\zlyfer\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Bookmarks";
const kandoPath = "C:\\Users\\zlyfer\\AppData\\Roaming\\kando\\";
const kandoMenuFileName = "menus.json";
const browserMenuName = "Chrome Bookmarks";
const faviconDirectory = path.join(kandoPath, "favicons");
const faviconFetchTimeoutMs = 1500;
const bookmarkFolderIconTemplate = path.join("D:\\Media\\Pictures\\Icons\\Alphabet", "letter-<letter>.svg");

type ImportProgress = {
	total: number;
	processed: number;
	lastPercent: number;
	currentDomain: string | null;
};

async function importBookmarks() {
	fs.mkdirSync(faviconDirectory, { recursive: true });

	const menuData = JSON.parse(fs.readFileSync(path.join(kandoPath, kandoMenuFileName), "utf-8"));

	const previousMenus: any[] = [];
	const nextMenus: any[] = [];

	let previous = true;
	menuData.menus.forEach((menu: any) => {
		if (previous && menu.root?.name !== browserMenuName) {
			previousMenus.push(menu);
		} else if (menu.root?.name === browserMenuName) {
			previous = false;
		} else if (!previous && menu.root?.name !== browserMenuName) {
			nextMenus.push(menu);
		} else {
			console.warn("Unexpected menu structure:", menu);
		}
	});

	const bookmarksData = JSON.parse(fs.readFileSync(browserProfilePath, "utf-8"));
	const bookmarkBar = bookmarksData.roots?.bookmark_bar ?? bookmarksData.roots?.other ?? bookmarksData.roots?.synced ?? { children: [] };
	const progress: ImportProgress = {
		total: countUrlBookmarks(bookmarkBar.children ?? []),
		processed: 0,
		lastPercent: -1,
		currentDomain: null
	};
	const importedChildren = await loopThroughBookmarks(bookmarkBar.children ?? [], progress);
	if (progress.total > 0) {
		process.stdout.write("\n");
	}

	const menus = Array.isArray(menuData.menus) ? menuData.menus : [];
	const menuIndex = menus.findIndex((menu: any) => menu?.root?.name === browserMenuName);

	const bookmarksMenu = menuIndex >= 0
		? menus[menuIndex]
		: {
			root: {
				name: browserMenuName,
				icon: "Google Chrome",
				iconTheme: "system",
				children: []
			}
		};

	bookmarksMenu.root = {
		...(bookmarksMenu.root || {}),
		name: browserMenuName,
		icon: bookmarksMenu.root?.icon || "Google Chrome",
		iconTheme: bookmarksMenu.root?.iconTheme || "system",
		children: importedChildren
	};

	if (menuIndex >= 0) {
		menus[menuIndex] = bookmarksMenu;
	} else {
		menus.push(bookmarksMenu);
	}

	const newMenuData = {
		...menuData,
		menus
	};

	fs.writeFileSync(path.join(kandoPath, kandoMenuFileName), JSON.stringify(newMenuData, null, 2), "utf-8");
	console.log(`Imported ${importedChildren.length} bookmark entries.`);
}

async function loopThroughBookmarks(bookmarks: any[] = [], progress?: ImportProgress) {
	const entries: any[] = [];

	for (const bookmark of bookmarks) {
		if (bookmark.type === "folder") {
			const children = await loopThroughBookmarks(bookmark.children ?? [], progress);
			entries.push(generateBookmarkFolder(bookmark.name || "Folder", children));
		} else if (bookmark.type === "url") {
			updateProgress(progress, bookmark.url);
			entries.push(await generateBookmarkItem(bookmark.name || bookmark.url, bookmark.url));
		}
	}

	return entries;
}

function countUrlBookmarks(bookmarks: any[] = []) {
	let total = 0;

	for (const bookmark of bookmarks) {
		if (bookmark.type === "folder") {
			total += countUrlBookmarks(bookmark.children ?? []);
		} else if (bookmark.type === "url") {
			total += 1;
		}
	}

	return total;
}

function updateProgress(progress?: ImportProgress, current?: string | null) {
	if (!progress || progress.total <= 0) {
		return;
	}

	progress.processed += 1;
	const percent = Math.floor((progress.processed / progress.total) * 100);
	const currentDomain = getBookmarkDomain(current);
	if (percent !== progress.lastPercent || progress.processed === progress.total || currentDomain !== progress.currentDomain) {
		progress.lastPercent = percent;
		progress.currentDomain = currentDomain;
		const line = `Import progress: ${progress.processed}/${progress.total} (${percent}%) ${currentDomain}`;
		if (process.stdout.isTTY && process.stdout.clearLine && process.stdout.cursorTo) {
			process.stdout.clearLine(0);
			process.stdout.cursorTo(0);
			process.stdout.write(`\r${line}`);
		} else {
			process.stdout.write(`${line}\n`);
		}
	}
}

function getBookmarkDomain(url?: string | null) {
	if (!url) {
		return "unknown";
	}

	try {
		return new URL(url).hostname.replace(/^www\./, "") || "unknown";
	} catch {
		return "unknown";
	}
}

function generateBookmarkFolder(name: string, children: any[]) {
	const folderIcon = resolveFolderIcon(name);

	return {
		"type": "submenu",
		"name": name,
		"icon": folderIcon.icon,
		"iconTheme": folderIcon.iconTheme,
		"children": children,
		"activateWorkflow": {
			"quickSelectKey": "Backspace",
			"actions": [
				{
					"type": "close-submenu"
				}
			]
		}
	};
}

function resolveFolderIcon(name: string) {
	const firstLetter = (name.trim()[0] || "").toLowerCase();
	if (!firstLetter || !/[a-z0-9]/.test(firstLetter)) {
		return {
			icon: "submenu-item.svg",
			iconTheme: "kando"
		};
	}

	const iconPath = bookmarkFolderIconTemplate.replace("<letter>", firstLetter);
	if (fs.existsSync(iconPath)) {
		return {
			icon: iconPath,
			iconTheme: "base64"
		};
	}

	return {
		icon: "submenu-item.svg",
		iconTheme: "kando"
	};
}

async function generateBookmarkItem(name: string, url: string) {
	const faviconPath = await downloadFavicon(url);

	return {
		"type": "button",
		"name": name,
		"icon": faviconPath || "uri-item.svg",
		"iconTheme": faviconPath ? "base64" : "kando",
		"selectWorkflow": {
			"actions": [
				{
					"type": "open-uri",
					"uri": url
				},
				{
					"type": "close-menu"
				}
			]
		}
	};
}

async function downloadFavicon(url: string) {
	if (!url) {
		return null;
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		return null;
	}

	const safeName = (parsedUrl.hostname || "bookmark")
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "") || "bookmark";
	const cachedFaviconPath = getCachedFaviconPath(safeName);
	if (cachedFaviconPath) {
		return cachedFaviconPath;
	}

	const providers = [
		{
			url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsedUrl.hostname)}&sz=64`,
			extension: "png"
		},
		{
			url: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(parsedUrl.hostname)}.ico`,
			extension: "ico"
		},
		{
			url: `${parsedUrl.origin}/favicon.ico`,
			extension: "ico"
		}
	];

	for (const provider of providers) {
		const downloaded = await tryDownloadFavicon(provider.url, safeName, provider.extension);
		if (downloaded) {
			return downloaded;
		}
	}

	return null;
}

function getCachedFaviconPath(safeName: string) {
	for (const extension of ["png", "ico", "svg", "jpg", "jpeg"]) {
		const filePath = path.join(faviconDirectory, `${safeName}.${extension}`);
		if (fs.existsSync(filePath)) {
			return filePath;
		}
	}

	return null;
}

async function tryDownloadFavicon(faviconUrl: string, safeName: string, extension: string) {
	const faviconFilePath = path.join(faviconDirectory, `${safeName}.${extension}`);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), faviconFetchTimeoutMs);

	try {
		const response = await fetch(faviconUrl, { signal: controller.signal });
		if (!response.ok) {
			return null;
		}

		const contentType = (response.headers.get("content-type") || "").toLowerCase();
		if (contentType.includes("text/html") || contentType.includes("text/plain")) {
			return null;
		}

		const bytes = Buffer.from(await response.arrayBuffer());
		if (!isValidFaviconBytes(bytes, extension)) {
			return null;
		}

		fs.writeFileSync(faviconFilePath, bytes);
		return faviconFilePath;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function isValidFaviconBytes(bytes: Buffer, extension: string) {
	if (bytes.length === 0) {
		return false;
	}

	if (extension === "ico") {
		if (bytes.length < 22) {
			return false;
		}

		const hasIcoHeader = bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00;
		if (!hasIcoHeader) {
			return false;
		}
	}

	return true;
}

async function main() {
	await importBookmarks();
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});