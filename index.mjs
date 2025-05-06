#!/usr/bin/env node

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import move from "./move.js";
// import move from "./cp.mjs";

import { Command } from "commander";
const program = new Command();

// get package json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const filePath = path.resolve(__dirname, "package.json");
const data = fs.readFileSync(filePath, "utf8");
const packageJson = JSON.parse(data);

program
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version);

program
  .description(
    "hbuilderX 打包后的h5资源，移动到指定的项目目录下，并且通过git上传."
  )
  .argument("[string]", "git commit detail", "test")
  .option("-t, --target <string>", "target directory", "build/h5")
  .action((name, options) => {
    console.log("git commit 填写信息 :>> ", name);
    // console.log("options.target :>> ", options.target);

    move("./unpackage/dist/build/web", options.target, "build: " + name);
    // move("./unpackage/dist/build/web", options.target)
    //   .then(() => console.log("复制成功"))
    //   .catch(console.error);
  });

program.parse();
