# 上架步骤 / Publishing

DSH 的插件市场（dsh-market，以及 0.2.1+ 的 **Plugins → Discover**）不自己收稿：它读的是
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 这份社区注册表。
所以流程是「先有公开 GitHub 仓库 → 去那边提一个加条目的 PR」。

步骤：

1. **把这个目录推到 GitHub**（仓库名建议就叫 `dsh-edit-last-turn`）：

   ```sh
   git init -b main
   git add -A
   git commit -m "dsh-edit-last-turn 0.2.0"
   git remote add origin git@github.com:tzy-aiy/dsh-edit-last-turn.git
   git push -u origin main
   ```

2. 仓库设置里加上 **`dsh-plugin`** topic（CI 会检查这一项）。

3. 账号信息已按 `tzy-aiy` 填好（`package.json` 的 `repository`/`homepage`、`entry.yml`、
   README 里的安装命令）。换 GitHub 账号时，这些地方搜 `tzy-aiy` 替换即可。

4. （可选）发 npm，能显示下载量、安装时跳过构建授权：

   ```sh
   npm publish --access public
   ```

   新包名发布后 registry 可能几分钟内仍是 `0.0.0-stage` 占位，等
   `https://registry.npmjs.org/dsh-edit-last-turn` 的 `dist-tags.latest` 指到 0.2.0 再提交。

5. **提注册表 PR**：fork `awesome-dsh-plugin/awesome-dsh-plugin`，把 `entry.yml` 的内容
   存成 `data/plugins/tzy-aiy__dsh-edit-last-turn.yml`（一个 PR 只加这一个文件，别手改 README，
   它们是脚本生成的），然后开 PR。

要求（CI 会查）：仓库声明了 `dsh.bundle`（本仓库有）、仓库创建满 1 天、有 `dsh-plugin` topic、
描述与代码一致、分类合理（这里是 `session`）。

合并后网站与市场通常一天内自动生效；之后的更新只要推自己的仓库即可，不用再提 PR。
