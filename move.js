const path = require("path");
const fs = require("fs");
const fsPromise = require("fs/promises");
const childProcess = require("child_process");

const { spawn, spawnSync } = childProcess;

async function main(src, dest, commitInfo) {
  const getProjectRoot = (startPath = __dirname) => {
    let currentDir = path.resolve(startPath);
    while (true) {
      // 检查是否存在 package.json  .git
      const hasPkg = fs.existsSync(path.join(currentDir, "package.json"));
      const hasGit = fs.existsSync(path.join(currentDir, ".git"));
      if (hasPkg || hasGit) return currentDir;

      // 到达根目录时终止
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
    throw new Error("未找到项目根目录");
  };

  // console.log("从脚本目录查找:", getProjectRoot(__dirname));
  // console.log("从工作目录查找:", getProjectRoot(process.cwd()));
  const projectRoot = getProjectRoot(process.cwd());
  // 检查git目录是否存在
  const gitDir = path.join(projectRoot, ".git");
  // console.log("gitDir :>> ", gitDir);
  if (!fs.existsSync(gitDir)) handleError("当前项目没有配置Git");

  const resourceDir = path.join(projectRoot, src + "/index.html");
  //   console.log("resourceDir :>> ", resourceDir);
  const hasBuild = fs.existsSync(resourceDir);
  if (!hasBuild) {
    handleError("未找打包完成的H5资源");
  }
  const targetDir = path.join(projectRoot, dest);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(dest + " 目录创建完成");
  }
  console.log("源目录 :>> ", path.join(projectRoot, src));
  console.log("目标目录 :>> ", targetDir);

  await moveFiles(path.join(projectRoot, src), targetDir);

  async function moveFiles(sourceDir, targetDir) {
    // console.log("sourceDir :>> ", sourceDir);
    // console.log("targetDir :>> ", targetDir);
    try {
      // 读取源目录内容
      const files = await fsPromise.readdir(sourceDir, { withFileTypes: true });
      for (const file of files) {
        const sourcePath = path.join(sourceDir, file.name);
        const targetPath = path.join(targetDir, file.name);

        if (file.isDirectory()) {
          // 创建目录
          await fsPromise.mkdir(targetPath, { recursive: true });
          // 递归处理子目录
          await moveFiles(sourcePath, targetPath);
        } else {
          await fsPromise.copyFile(sourcePath, targetPath);
        }
      }
    } catch (error) {
      handleError(error.message);
    }
  }

  console.log("🎉 所有文件复制完成 ");
  spawnSync("cd", [projectRoot]);
  const pwd = spawnSync("pwd");
  console.log("当前执行路径：", pwd.stdout.toString());

  const gitCommands = [
    { cmd: "git", args: ["add", "."] },
    { cmd: "git", args: ["commit", "-m", commitInfo] },
    { cmd: "git", args: ["push"] },
  ];

  for (const command of gitCommands) {
    const result = spawnSync(command.cmd, command.args, { stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`命令 ${command.cmd} 执行失败，退出码: ${result.status}`);
      handleError(`命令 ${command.cmd} 执行失败`);
      process.exit(1); // 终止后续命令
    }
  }

  // 基础版：红色错误提示 + 退出码
  function handleError(message, code = 1) {
    console.error("\x1b[31mERROR:\x1b[0m", message);
    process.exit(code);
  }
}

module.exports = main;
