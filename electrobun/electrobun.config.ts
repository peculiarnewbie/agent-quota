import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "agent-quota",
		identifier: "agentquota.electrobun.dev",
		version: "0.0.1",
	},
	runtime: {
		exitOnLastWindowClosed: false,
	},
	build: {
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			"src/mainview/assets/tray-icon.png": "views/mainview/assets/tray-icon.png",
		},
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
			chromiumFlags: {
				"remote-debugging-port": process.env.AGENT_QUOTA_REMOTE_DEBUG_PORT ?? "9334",
			},
		},
	},
} satisfies ElectrobunConfig;
