const fs = require("fs");

const browserProfilePath = "C:\\Users\\zlyfer\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Bookmarks";
const kandoMenuPath = "C:\\Users\\zlyfer\\AppData\\Roaming\\kando\\menus.json";
const browserMenuName = "Chrome Bookmarks";

function importBookmarks() {
	// Kando Menu
	const menuData = JSON.parse(fs.readFileSync(kandoMenuPath, "utf-8"));

	const previousMenus: any = [];
	const nextMenus: any = [];

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

	// Browser Bookmarks
	const bookmarksData = JSON.parse(fs.readFileSync(browserProfilePath, "utf-8"));
	let bookmarksMenu = menuData.menus.find((menu: any) => menu.root?.name === browserMenuName);
	bookmarksMenu.root.children = loopThroughBookmarks(bookmarksData.roots.bookmark_bar);
	console.log(bookmarksMenu.root.children);

	// Applying:
	const newMenuData = {
		...menuData,
		menus: [...previousMenus, bookmarksMenu, ...nextMenus]
	}
	fs.writeFileSync(kandoMenuPath, JSON.stringify(newMenuData, null, 2), "utf-8");
}

function loopThroughBookmarks(bookmark: any) {
	const entries: any = [];

	if (bookmark.type === "folder") {
		const children: any = [];
		for (let i = 0; i < bookmark.children.length; i++) {
			const child = bookmark.children[i];
			children.push(...loopThroughBookmarks(child));
		}
		entries.push(generateBookmarkFolder(bookmark.name, children));
	}

	if (bookmark.type === "url") {
		entries.push(generateBookmarkItem(bookmark.name, bookmark.url));
	}

	return entries;
}

function generateBookmarkFolder(name: string, children: any[]) {
	return {
		"type": "submenu",
		"name": name,
		"icon": "submenu-item.svg",
		"iconTheme": "kando",
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

function generateBookmarkItem(name: string, url: string) {
	return {
		"type": "button",
		"name": name,
		"icon": "uri-item.svg",
		"iconTheme": "kando",
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

function main() {
	importBookmarks();
}

main();