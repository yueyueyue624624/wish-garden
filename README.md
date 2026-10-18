# Wish Garden 愿望花园

移动端优先的私密生日愿望管理应用。前端部署在 Vercel，登录与数据库使用 Supabase。

## 安全模型

- 主人通过 Supabase Auth 的邮箱密码登录，登录限速由 Supabase Auth 执行。
- 朋友通过高熵邀请链接进入，并绑定一个 Supabase 匿名身份。
- 基础表不向浏览器角色开放。所有操作都通过 `SECURITY DEFINER` 数据库函数进行身份校验。
- 朋友只能读取和编辑自己的愿望；返回数据中完全不包含购买状态。
- 撤销或重新生成邀请会增加版本号，旧链接和已绑定的旧会话立即失效。
- 主人可以修改或删除朋友、标记礼物状态、导出完整 JSON 备份。

## Supabase 初始化

1. 新建 Supabase 项目。
2. 在 SQL Editor 运行 `supabase-schema.sql`。
3. 在 Authentication → Users 创建主人账号。
4. 在 SQL Editor 运行下面语句，把该账号设为主人：

```sql
insert into public.owner_profiles(id)
select id from auth.users where email='你的主人邮箱';
```

5. 在 Authentication → Providers 中启用 Anonymous Sign-Ins。
6. 从 Project Settings → API 复制 Project URL 和 publishable/anon key。

## 本地运行

```bash
npm install
copy .env.example .env.local
npm run dev
```

在 `.env.local` 填入：

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

## Vercel 部署

1. 从 GitHub 导入此仓库。
2. Framework Preset 选择 Vite（通常会自动识别）。
3. 添加 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 两个环境变量。
4. 部署后把 Vercel 域名加入 Supabase Authentication → URL Configuration 的允许重定向地址。

`vercel.json` 已配置 `/owner`、`/friend` 和 `/invite/*` 的单页应用路由。

## 免费额度说明

个人小规模使用通常适合 Vercel 与 Supabase 的免费层，但免费层额度和休眠/备份政策可能变化。初始化脚本会每天 03:00（北京时间）在数据库内保存一份 JSON 快照；它可防误删，但不属于异地备份。应用内同时保留 JSON 导出，建议定期下载到自己的设备。
