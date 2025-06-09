import { build } from "esbuild";

const isProd = process.argv.includes("production");

const buildOptions = {
	entryPoints: ["main.ts"],
	bundle: true,
	minify: isProd,
	platform: "browser",
	outfile: "main.js",
	external: ["obsidian"],
	format: "cjs"
};

if (!isProd) {
	buildOptions.watch = {
		onRebuild(error, result) {
			if (error) console.error("watch build failed:", error);
			else console.log("watch build succeeded");
		},
	};
}

build(buildOptions).then(() => {
	console.log("build succeeded");
}).catch(() => process.exit(1));
