"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PKG_DIR = path.resolve(__dirname, "..");
const MOVE_JS = path.join(PKG_DIR, "move.js");
const move = require(MOVE_JS);

const sandboxes = [];

after(() => {
  for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
});

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} 失败 (status=${result.status})\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function newSandboxDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbm-test-"));
  sandboxes.push(dir);
  return dir;
}

/**
 * 建一个和真实使用一致的仓库：本地仓库已 init、已有首次提交、已关联 origin。
 * origin 用本地裸仓库代替 GitHub，push 走文件系统，不依赖网络和凭据。
 */
function makeRepo({ withBuild = true } = {}) {
  const root = newSandboxDir();
  const remote = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);

  git(["init", "--bare", "-b", "main", remote], root);
  git(["init", "-b", "main"], repo);
  git(["config", "user.name", "hbm-test"], repo);
  git(["config", "user.email", "hbm-test@example.com"], repo);
  git(["config", "commit.gpgsign", "false"], repo);
  git(["remote", "add", "origin", remote], repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# sandbox\n");
  git(["add", "."], repo);
  git(["commit", "-m", "init"], repo);
  git(["push", "-u", "origin", "main"], repo);

  if (withBuild) {
    const web = path.join(repo, "unpackage", "dist", "build", "web");
    fs.mkdirSync(path.join(web, "static"), { recursive: true });
    fs.writeFileSync(path.join(web, "index.html"), "<!DOCTYPE html><h1>built</h1>\n");
    fs.writeFileSync(path.join(web, "static", "app.js"), "console.log('built');\n");
  }

  return { root, repo, remote };
}

/** 失败路径走子进程：move 里的 handleError 会直接 process.exit */
function runMoveInChild(cwd, src, dest, message) {
  const code =
    `require(${JSON.stringify(MOVE_JS)})` +
    `(${JSON.stringify(src)}, ${JSON.stringify(dest)}, ${JSON.stringify(message)});`;
  return spawnSync(process.execPath, ["-e", code], { cwd, encoding: "utf8" });
}

/** move 靠 process.cwd() 找项目根，测试期间临时切目录，结束后务必恢复 */
async function inDir(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

test("package.json 的 main 指向真实存在的入口，require 包根目录能拿到函数", () => {
  const entry = require.resolve(PKG_DIR);
  assert.ok(fs.existsSync(entry), `main 指向的文件不存在: ${entry}`);
  assert.strictEqual(path.resolve(entry), MOVE_JS);
  assert.strictEqual(typeof require(PKG_DIR), "function");
});

test("项目没有初始化 git 时报错并以 1 退出", () => {
  const dir = newSandboxDir();
  fs.writeFileSync(path.join(dir, "package.json"), "{}\n");

  const result = runMoveInChild(dir, "./unpackage/dist/build/web", "build/h5", "build: t");

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /没有配置Git/);
});

test("没有打包产物时报错并以 1 退出", () => {
  const { repo } = makeRepo({ withBuild: false });

  const result = runMoveInChild(repo, "./unpackage/dist/build/web", "build/h5", "build: t");

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /未找打包完成的H5资源/);
});

test("正常流程：清空旧目标目录、递归复制、提交并推送到远端", async () => {
  const { root, repo, remote } = makeRepo();

  // 目标目录里预置旧文件，验证会被整体清掉
  fs.mkdirSync(path.join(repo, "build", "h5"), { recursive: true });
  fs.writeFileSync(path.join(repo, "build", "h5", "stale.txt"), "old file\n");

  await inDir(repo, () => move("./unpackage/dist/build/web", "build/h5", "build: v1"));

  const target = path.join(repo, "build", "h5");
  assert.ok(!fs.existsSync(path.join(target, "stale.txt")), "旧文件应被删除");
  assert.strictEqual(
    fs.readFileSync(path.join(target, "index.html"), "utf8"),
    "<!DOCTYPE html><h1>built</h1>\n"
  );
  assert.strictEqual(
    fs.readFileSync(path.join(target, "static", "app.js"), "utf8"),
    "console.log('built');\n"
  );

  // 名字叫 move，实际是 copy，源产物必须还在
  assert.ok(fs.existsSync(path.join(repo, "unpackage", "dist", "build", "web", "index.html")));

  // 已提交、已推送
  assert.strictEqual(git(["log", "-1", "--format=%s"], repo), "build: v1");
  assert.strictEqual(git(["status", "--porcelain"], repo), "");
  assert.strictEqual(git(["--git-dir", remote, "log", "-1", "--format=%s"], root), "build: v1");
});

test("目标目录不存在时自动创建，支持多级路径", async () => {
  const { repo } = makeRepo();

  await inDir(repo, () => move("./unpackage/dist/build/web", "static/h5/v1", "build: nested"));

  const target = path.join(repo, "static", "h5", "v1");
  assert.ok(fs.existsSync(path.join(target, "index.html")));
  assert.ok(fs.existsSync(path.join(target, "static", "app.js")));
  assert.strictEqual(git(["log", "-1", "--format=%s"], repo), "build: nested");
});

test("在子目录里运行也能定位到项目根，并把仓库根的全部改动一起提交", async () => {
  const { repo } = makeRepo();

  // 在产物目录里执行，模拟「在编辑器终端里从当前文件所在目录运行」
  const sub = path.join(repo, "unpackage", "dist", "build", "web");
  await inDir(sub, () => move("./unpackage/dist/build/web", "build/h5", "build: from subdir"));

  // 产物落在仓库根下的 build/h5，而不是子目录里再套一层
  assert.ok(fs.existsSync(path.join(repo, "build", "h5", "index.html")));
  assert.ok(!fs.existsSync(path.join(sub, "build")));
  // 工作区干净：说明 git add 是在仓库根执行的，没有漏掉其他改动
  assert.strictEqual(git(["status", "--porcelain"], repo), "");
  assert.strictEqual(git(["log", "-1", "--format=%s"], repo), "build: from subdir");
});
