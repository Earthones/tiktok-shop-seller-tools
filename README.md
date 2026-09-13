# TikTok Shop 卖家工具箱

适用于 Tampermonkey（油猴）的卖家中心辅助脚本，支持主站与越南独立站。

## 安装与更新

安装油猴后，打开 [脚本安装 / 更新地址](https://raw.githubusercontent.com/Earthones/tiktok-shop-seller-tools/main/tiktok-shop-partial-refund.user.js)，在油猴中确认安装或更新。

已有旧版本时，用这个地址更新同一个脚本；保留脚本名称与 namespace，不要同时启用两份脚本。

当前版本：**0.19.2**。

脚本通过 `@updateURL`、`@downloadURL` 和 `@version` 使用油猴内置更新机制，不在页面内自行下载并执行 GitHub 代码。请在油猴中保持此脚本的更新检查开启。更新周期由油猴设置决定，上传新版后不保证立即更新；也可以在油猴中手动检查更新。

更新字段说明见 [Tampermonkey 官方文档](https://www.tampermonkey.net/documentation.php?locale=en#meta:updateURL)。

## 使用提醒

- 适用网址：`seller.tiktokshopglobalselling.com`、`seller-vn.tiktok.com`。
- 已送达、仅退款、退货退款等操作会向卖家平台发送真实请求，请先核对订单、地区、金额和处理条件。
- 设置、自动计划与日志保存在对应站点的浏览器本地存储中，不上传到此 GitHub 仓库；清除网站数据会影响这些记录。
- 刷新网页后恢复已保存的自动计划；关闭浏览器期间不会执行，后台标签页的调度时间也可能受浏览器限制。
- 平台前端接口或 SDK 发生变化时，脚本可能需要适配。本脚本不是 TikTok 官方产品。

## 发布新版本

1. 修改脚本并测试，同步提高顶部 `@version` 和 `APP_VERSION`。
2. 更新本说明的当前版本。
3. 在本地工作目录执行以下命令，将经过审查的文件上传到 `main`：

```powershell
node --check tiktok-shop-partial-refund.user.js
git add -- tiktok-shop-partial-refund.user.js README.md .gitignore
git commit -m "Release new userscript version"
git push origin HEAD:main
```

固定更新地址中的文件名、仓库名和 `main` 分支请保持不变，否则旧版本将无法继续从原地址更新。

仓库仅包含脚本、说明和忽略规则，不包含 Cookie、登录凭据、订单列表、导出日志、设置备份或测试截图。分享问题时也请先脱敏。
