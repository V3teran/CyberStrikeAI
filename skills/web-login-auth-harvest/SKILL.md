---
name: web-login-auth-harvest
description: >-
  面对 Web 登录页:自动分析前端 JS 定位登录加密逻辑(RSA/AES/国密SM2/SM4/MD5加盐/sign签名/时间戳nonce/验证码token),
  用不同权限账密复现加密并自动登录,把登录后的身份凭证(Cookie/JWT/access_token/refresh_token 等,含 query/header/body/localStorage
  多位置)结构化落库到项目黑板,供后续越权/横向/接管流程共享复用。Use when hitting a login page, reversing client-side
  login crypto, automating multi-account login, or harvesting session credentials into the blackboard.
metadata:
  tags: [渗透测试, penetration-testing, 红队, 认证, 登录加密, 凭证采集, 项目黑板]
---

# Web 登录加密分析 & 凭证采集入黑板

> 在 CyberStrikeAI 多代理会话中由 `skill` 工具渐进加载。目标:**站在一个 Web 登录页面前,自动搞清"密码/参数在前端被怎么加密的",用给定的多组(不同权限)账密真正登进去,再把每个身份登录后的凭证连同"怎么注入才能复用"一起写进黑板**,让后续的越权(见 `broken-access-control`)、横向、接管流程直接拿来用。
>
> 它给的是**分析方向与判定原则**,不是死步骤。所有动作都映射到 CSAI 自身工具。凭证是敏感物,遵守授权范围与脱敏纪律(见收尾)。

## CSAI 工具映射(先读,全篇按此落地)

| 动作 | CSAI 工具 |
|---|---|
| **登录路径 A — 浏览器直登**:填账密点登录,让页面 JS 自己加密(不用逆算法);登录后读凭证 | `browser_navigate` 打开登录页操作 + 读 Cookie/localStorage/sessionStorage 与后续请求头 |
| **登录路径 B — HTTP 直发**:抓登录页 / 抓 JS / 自己构造并发登录请求 / 重放 | `exec` 跑 `curl`(`-i` 看状态+头看 `Set-Cookie`,`-s` 存盘;cookie jar、下载的 JS 一律写会话工作目录,**禁用 `/tmp`**) |
| 动态调试 JS(下断点、看加密函数入参出参、读运行期变量/`window` 对象、抓 XHR/fetch 载荷) | `browser_navigate` 打开登录页,在真实浏览器里观察加密前后的明文/密文对照 |
| 复现加密算法(RSA/AES/SM2/SM4/MD5/HMAC/sign),把明文密码算成前端一样的密文 | `execute-python-script`(pycryptodome、`gmssl` 做国密 SM2/SM4、`rsa`、`hashlib`);或 `exec` 跑 `node -e`(直接复用抠出来的 `CryptoJS`/`jsencrypt`/`sm-crypto` 片段)、`openssl` |
| 装复现所需依赖 | `install-python-package`(pycryptodome / gmssl / pyDes …) |
| 抓/解 JWT、判断可否伪造 | `jwt-analyzer`(或 `exec` 跑 `jwt_tool`);详见 `web-attack-methods` 的 JWT 段 |
| 抓登录相关参数、发现隐藏字段/额外入参 | `paramspider` / `arjun`(补充手段);主路径仍是读 JS + 看真实请求 |
| 记「一个可用身份 / 其凭证特征 / 认证态 / 怎么注入复用」 | `upsert_project_fact`,`fact_key` 建议 `auth/<identity>`(如 `auth/admin`、`auth/user-low`),**同 key 覆盖** |
| 记「登录加密逻辑完整链:算法 + 密钥来源 + 复现命令」 | `upsert_project_fact`,`fact_key` 建议 `auth/login-crypto`,body 必填算法定位+复现脚本 |
| 记「登录环节本身的可交付漏洞」(如密钥硬编码、可预测 token、明文回传) | `record_vulnerability`(title, severity, vulnerability_type, target, proof, impact, recommendation) |
| 查同类知识 / 查重 | `search_knowledge_base`、`list_vulnerabilities` |

- **边渗透边记录(强制节奏)**:每**真正登进**一个身份 → 立即 `upsert_project_fact(auth/<identity>)`,把凭证 + 注入方式钉进黑板;每**搞清一次加密链** → 立即 `upsert_project_fact(auth/login-crypto)`。别等全部账号跑完再批量写,上下文一压缩就丢。
- 与 `pentest-blackboard` 的写入规范一致:`auth/*` 事实 summary 一行写清「什么身份 + 凭证在哪个位置 + 怎么注入」,完整密文/jar 路径/复现命令进 body。

## 总体节奏(四个阶段,不是死流程)

面对登录页,脑子里跑这条主线,每一步产出立即落库:

1. **观察** —— 登录请求长什么样?抓一次真实登录,看明文密码到底以什么形态发出去(明文?一坨 Base64?十六进制?带 `sign`/时间戳?)。
2. **选登录路径**(关键分流)—— 自动登录有两条路,按目标复杂度选:
   - **A. 浏览器直登**(`browser_navigate`):在真实浏览器里填账密点登录,**页面自己的 JS 完成加密**,你不用逆任何算法就能登进去。加密越复杂(重混淆、国密、运行时拼 key、验证码),这条越省事,是**首选**。
   - **B. HTTP 直发**(`exec` 跑 curl):不开浏览器,自己构造登录请求。前提是**先逆出加密**(阶段 2 + 3.1)把密码算成密文。适合批量/多账号快速登录、无头环境、要沉淀可复现命令的场景。
3. **定位加密 + 复现登录** —— 走 A 就轻量看 JS(仍要为黑板记加密链、挖登录环节漏洞);走 B 必须逆出算法并在 CSAI 里复现密文,逐身份登进去。
4. **采集入黑板** —— 不论哪条路径,登录成功后抓服务端下发/前端存储的全部凭证,连同"下次怎么注入"一起写进 `auth/*`。

**怎么选**:能开浏览器且账号数不多 → 优先 A(快、不怕加密);要跑很多账号、或需要留下 curl 复现命令、或无头环境 → 走 B。两条路径产出的凭证落库格式完全一样(阶段 4)。卡住就换路径或换手段(A 卡在验证码 → 人工介入;B 算法对不上 → 回 observe 查字段/顺序/编码,或干脆退回 A 让浏览器加密),别原地重试。

## 阶段 1:观察真实登录请求(先别急着读 JS)

**永远先抓一次真实登录看它发什么**——这决定了后面要不要做加密分析。用 `browser_navigate` 打开登录页,在真实浏览器里正常输入一组账密登录,观察发出的 XHR/fetch:请求 URL、方法、Content-Type、请求体原文、以及响应里的 `Set-Cookie` 和 body。

对照"你输入的明文"和"实际发出的值",判断密码字段的形态:

| 发出的形态 | 大概率是什么 | 去阶段 2 找什么 |
|---|---|---|
| 和你输的明文一模一样 | **无前端加密**(靠 HTTPS) | 跳过加密,直接阶段 3 用明文登录 |
| 定长 32/40/64 位十六进制 | MD5 / SHA1 / SHA256(常加盐) | 找 `md5(`/`SHA`/盐的拼接顺序 |
| 一长串 Base64、每次登录都变 | RSA(`jsencrypt`)或 SM2 | 找公钥字符串 + `encrypt(` |
| 定长 Base64/hex、每次相同明文密文也相同 | AES/DES/SM4 **ECB**(密钥硬编码) | 找 key/iv/mode |
| 带 `sign`/`signature` + `timestamp`/`nonce` 字段 | 参数签名(HMAC/MD5 拼接) | 找签名串拼接规则 + 密钥 |
| body 里有 `captcha`/`captchaId`/`randomKey`/`uuid` | 验证码 / 一次性 challenge | 阶段 3 要先取 challenge 再登录 |

> 关键提醒:**先看清楚"哪些字段参与、以什么顺序、什么编码"再去逆 JS**。80% 的加密复现失败是栽在字段顺序、编码(Base64 vs hex)、大小写、末尾换行、时间戳单位(秒/毫秒)这些细节上,而不是算法本身逆错。

## 阶段 2:定位前端加密逻辑

只有阶段 1 判定"密码不是明文发出"时才做这步。静态 + 动态互补,哪条快用哪条。

### 静态:读 JS 抠算法

1. **抓全登录页引用的 JS**:`curl` 把登录页 HTML 存盘,提取所有 `<script src>`,逐个 `curl` 下来(都写工作目录)。打包压缩的 `app.xxxx.js` 也照抓。
2. **搜关键指纹**(在下载的 JS 里 `grep -riE`):
   - RSA:`setPublicKey`、`JSEncrypt`、`-----BEGIN PUBLIC KEY`、`getPublicKey`
   - AES/DES:`CryptoJS`、`AES`、`mode.ECB`/`CBC`、`Utf8.parse`、`enc.Base64`、`createCipher`
   - 国密:`sm2`、`sm4`、`sm-crypto`、`doEncrypt`、`SM2`、`gmssl`(**国内目标高频,别漏**)
   - 哈希/签名:`md5(`、`hmac`、`CryptoJS.HmacSHA256`、`sign =`、`signature`、`salt`
   - 密钥/公钥常直接**硬编码**在 JS 里 → 找到即记(这本身常是可交付 finding)。
3. **顺着调用链读**:从表单 submit / 登录按钮的事件处理器,跟到密码字段被读取、被传进加密函数的那几行,搞清:**算法 + 模式 + key/iv/公钥来源 + 编码方式 + 参与字段和拼接顺序**。压缩混淆的代码,配合动态断点更快。

### 动态:浏览器里断点看入参出参

静态抠不动(重度混淆、密钥运行时才拼出、webpack 拆分)时,用 `browser_navigate` 打开登录页做动态观测。核心是**拿到"明文 → 密文"的对照样本和加密函数的真实入参**:

- 在加密函数(如认出的 `encrypt`/`doEncrypt`)或 `XMLHttpRequest.send`/`fetch` 上下断点,输入一组已知明文密码触发,读断点处的实参:key、iv、公钥、以及拼接好待加密的完整字符串。
- 拿到 key/公钥后,加密就变成"纯算法复现",进入阶段 3。
- 拿不到算法但能稳定拿到"明文→密文"映射时,退一步:**把浏览器当加密黑盒**——阶段 3 用浏览器对每个待登录密码求一次密文,再拿密文走 curl 登录(不优雅但能推进)。

### 把加密链落库

搞清后立即 `upsert_project_fact(auth/login-crypto)`:summary 一行写「密码走 X 算法,key/公钥在 Y,参与字段+顺序为 Z」;body 放:命中的 JS 文件与行号、算法/模式/编码、key/iv/公钥原文、字段拼接顺序、以及**可直接跑的复现脚本**(阶段 3 产出)。密钥硬编码/可预测等问题另开 `record_vulnerability`。

## 阶段 3:自动登录(两条路径,逐身份跑)

给定多组账密(如一组高权 admin、一组低权 user),**每组独立走一遍**,各自的会话互不污染(浏览器用独立 profile/上下文,curl 用独立 cookie jar / token 变量)。按阶段 2 的分流选路径:

### 3.0 路径 A:浏览器直登(加密复杂时首选,不用逆算法)

用 `browser_navigate` 打开登录页,像真人一样填账密、处理验证码、点登录——**加密由页面自己的 JS 完成**,你完全不碰算法。适合重混淆/国密/运行时拼 key/带验证码的目标。

- 每个身份用独立浏览器上下文登录,避免上一个身份的 Cookie/storage 残留。
- 登进去后**直接进阶段 4** 读凭证(从浏览器读 Cookie、localStorage、sessionStorage,以及登录后请求带的 header)。
- 即便走 A 登录,**仍要为黑板补一条 `auth/login-crypto`**(轻量记录:密码走什么算法、公钥/密钥位置)并顺手挖登录环节漏洞——别因为"能登进去就行"而漏了这部分情报。
- A 卡在图形验证码/滑块且识别不了 → 就地暂停问用户,别硬爆。

### 3.1 路径 B:复现加密算法(要自己发 HTTP 请求时)

走 curl 直发就得先把密码算成前端一样的密文。用 `execute-python-script` 或 `exec` 跑 `node -e`,几个高频算法的复现骨架:

```python
# RSA(jsencrypt):公钥抠自 JS,注意 jsencrypt 用 PKCS#1 v1.5,每次密文随机是正常的
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5
import base64
pub = "-----BEGIN PUBLIC KEY-----\n<抠自JS的Base64>\n-----END PUBLIC KEY-----"
cipher = PKCS1_v1_5.new(RSA.importKey(pub))
print(base64.b64encode(cipher.encrypt(b"PASSWORD")).decode())
```

```python
# AES-ECB(CryptoJS 常见:key 用 Utf8.parse,输出 Base64)
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
import base64
key = b"1234567890abcdef"  # 抠自 JS
ct = AES.new(key, AES.MODE_ECB).encrypt(pad(b"PASSWORD", 16))
print(base64.b64encode(ct).decode())
```

```python
# 国密 SM2(sm-crypto 默认 C1C3C2,输出常带/不带 04 前缀,两种都试)
from gmssl import sm2
c = sm2.CryptSM2(public_key="<hex公钥,去掉04>", private_key="", asn1=False)
print(c.encrypt(b"PASSWORD").hex())
```

```python
# 加盐 MD5 / sign 签名:关键是拼接顺序和大小写,严格照 JS 来
import hashlib, time
pwd = hashlib.md5(("PASSWORD" + "salt_from_js").encode()).hexdigest()
ts = str(int(time.time() * 1000))                    # 注意秒 vs 毫秒
sign = hashlib.md5(f"password={pwd}&timestamp={ts}&key=SECRET".encode()).hexdigest().upper()
```

**验证复现是否正确**:拿阶段 1/2 里"同一个明文的已知密文样本"和你算出来的对比。ECB/MD5/HMAC 这类确定性算法**必须字节一致**;RSA/SM2 这类每次随机的,靠"能成功登录"来验证。对不上就回头查字段顺序、编码、末尾换行、时间戳单位。

### 3.2 处理动态前置项(验证码 / challenge / CSRF)

若阶段 1 看到 body 带 `captcha`/`randomKey`/`csrf`/`nonce` 等一次性值,登录前要先取:

```bash
# 先 GET 登录页/接口拿 CSRF token、randomKey、captchaId(从 HTML 隐藏域或 JSON 响应)
curl -s -c jar_admin.txt 'https://TARGET/login' -o login_page.html
```

- 图形验证码挡路时:能识别就识别,识别不了**就地暂停问用户要验证码**,别硬爆(触风控反而测不下去);记下"登录受验证码限制"。
- `randomKey`/一次性公钥:很多系统每次登录先要一个随机 key 再拿它加密密码 → 顺序是"取 key → 用 key 加密 → 带 key 一起提交"。

### 3.3 构造登录请求,逐身份登进去

```bash
# cookie-based:捕获 Set-Cookie 到该身份专属 jar
curl -i -c jar_admin.txt -b jar_admin.txt \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<算出的密文>","sign":"...","timestamp":"..."}' \
  'https://TARGET/api/login'

# token-based:从响应 JSON 取 access_token/refresh_token
curl -s -d '...' 'https://TARGET/api/login' | tee resp_admin.json
```

判断"真的登进去了"看响应,不只看状态码:响应体是否含 `code:0`/`success:true`、是否下发了 Cookie 或 token、拿它访问一个受保护接口是否 2xx 且返业务数据。**登录连续 2 次仍失败就停手**——账号可能锁定/密码错/加密仍不对,把该身份标记为"未取得会话",别拿假身份污染后续越权矩阵(见 `broken-access-control` 的可获得身份约束)。

## 阶段 4:采集身份凭证 → 落库(本 skill 的核心产出)

登录成功后,身份凭证可能散落在**多个位置**,只抓 Cookie 会漏掉一大半现代应用(SPA + JWT 尤其如此)。逐个位置排查,把"后续请求要带什么才算这个身份"完整拼出来。

### 凭证可能出现的位置 & 常见字段(逐个查全)

| 位置 | 怎么拿到 | 常见字段/形态 | 后续怎么注入复用 |
|---|---|---|---|
| **响应 `Set-Cookie` 头** | `curl -i` 看响应头 / jar 文件 | `JSESSIONID`、`PHPSESSID`、`session`、`sid`、`token`、`access_token`、`SESSION`(Spring)、`auth`、`remember-me`;注意 `HttpOnly`/`Secure`/`SameSite`/`Path`/`Domain` 属性 | 请求带 `-b jar.txt` 或 `Cookie: JSESSIONID=...` |
| **响应 body(JSON)** | 存下登录响应 JSON | `access_token`、`refresh_token`、`token`、`id_token`、`accessToken`、`ticket`、`sessionId`、`Authorization`、`data.token`、`X-Auth-Token`、过期 `expires_in`/`expiresAt` | 多数放进后续请求 `Authorization: Bearer <token>` |
| **请求 header(前端下次带)** | 看阶段 1 里登录后的后续请求 | `Authorization: Bearer <jwt>`、`X-Token`、`X-Auth-Token`、`X-Access-Token`、`X-Api-Key`、`token`、`X-CSRF-Token`(状态改写要带) | 原样加到 `-H` |
| **URL query** | 看后续请求 URL | `?token=`、`?access_token=`、`?sid=`、`?ticket=`(CAS)、`?auth=`、`?sign=` | 拼进 URL |
| **localStorage / sessionStorage** | `browser_navigate` 后读存储(SPA 最常见把 JWT 存这里) | `token`、`access_token`、`vuex`(整个 store 里嵌 token)、`user`、`Authorization`、`refreshToken`、`satoken`(Sa-Token 框架) | 前端启动时读 storage → 塞进 header;curl 复用时直接把该值当 `Authorization`/自定义头 |
| **响应体里的二段式** | 登录只给 `refresh_token`,再换 `access_token` | `refresh_token` → 调 `/oauth/token` 换短期 token | 记下换取端点,凭证会过期时用 |

> **判断"真正生效的凭证是哪个"**:不要把登录响应里所有字段一股脑当凭证。做一次**最小验证**——只带某个候选凭证去请求一个受保护接口,能 2xx 返业务数据的才是真凭证。有的系统 Cookie 和 header token 二者其一即可,有的必须 Cookie + `X-CSRF-Token` 组合。把"最小可用注入集"确定下来再落库。

### 特别关注 JWT

响应/storage 里拿到形如 `xxx.yyy.zzz` 的即 JWT:用 `jwt-analyzer` 解 header/payload,记下 `alg`、`exp`、以及 payload 里的**身份声明**(`role`/`authorities`/`isAdmin`/`uid`/`tenant`)。这些声明是后续垂直越权的直接线索(能否 `alg:none`/弱密钥伪造改 role,见 `web-attack-methods` JWT 段)。

### 落库格式(每个成功身份一条 `auth/<identity>`)

每登进一个身份,立即写。summary 一行让索引就能看懂"这是谁、凭证在哪、怎么带";body 放可直接复制粘贴的完整注入方式:

```
fact_key: auth/admin
confidence: confirmed
summary: admin 身份已登录;凭证=JWT 放 Authorization 头 + JSESSIONID Cookie,二者需同带;token 2h 过期
links: [{from: target/login-endpoint, type: discovered_on}]
body:
  - 账号: admin / <密码明文或"见任务输入">
  - 登录端点: POST https://TARGET/api/login (Content-Type: application/json)
  - 密码加密: RSA(jsencrypt),复现见 auth/login-crypto
  - 生效凭证(最小可用注入集,已验证):
      Header: Authorization: Bearer eyJ...   ← 主凭证
      Cookie: JSESSIONID=ABC123...           ← 需同带,否则 403
  - JWT payload 身份声明: {"role":"ADMIN","uid":1001,"exp":...}
  - refresh: POST /oauth/token 用 refresh_token 换新 access_token
  - jar 文件: <工作目录>/jar_admin.txt
  - 复现登录命令(copy 即跑):
      curl -i -c jar_admin.txt -H 'Content-Type: application/json' \
        -d '{"username":"admin","password":"<密文>"}' https://TARGET/api/login
  - 授权访问验证: curl -s -b jar_admin.txt -H 'Authorization: Bearer eyJ...' \
        https://TARGET/api/profile → 200 返回 admin 资料
```

低权身份同理写 `auth/user-low`。两条以上不同权限身份到位后,后续可直接交给 `broken-access-control` 做多身份对比式越权——它明确认可"从任务账密登录拿到的会话"算可获得身份。

## 顺手记录登录环节自身的漏洞

分析登录加密时常直接撞见可交付漏洞,别只顾着登进去而漏报。命中就 `record_vulnerability`:

- **加密密钥/公钥硬编码在前端 JS**,或 AES/SM4 用固定 key + ECB → 密文可离线构造/前端加密形同虚设(`CWE-321`/`CWE-798`)。
- **密码明文回传**(HTTPS 之外无任何加密,或 Base64 冒充加密)→ 中间人可读(`CWE-319`)。
- **可预测/可复用的 token**:登录 token 是自增、时间戳、或 MD5(username) 等可预测值(`CWE-330`/`CWE-340`)。
- **JWT 可伪造**:`alg:none` 接受、弱密钥可爆破、密钥硬编码 → 直接伪造任意身份(`CWE-347`)。
- **签名 sign 校验形同虚设**:服务端只查 `sign` 非空、不真正校验 → 参数可篡改(参考 `web-attack-methods` 的 sign 弱点段)。
- **无锁定/无速率限制的登录**:可撞库/爆破(`CWE-307`);但**本 skill 默认不主动爆破**,只在明确授权时做且注意风控。

## 误报 / 踩坑排除

`record_vulnerability` 或宣布"已登录"前过一遍:

- **登录"成功"必须双重判断**:状态码 2xx **且** 响应体是成功语义(`code:0`/下发了凭证),不是 200 包着 `{"code":1,"msg":"密码错误"}`。
- **密文对不上不等于算法错**:先排字段顺序、编码(Base64/hex/URL-encode)、大小写、末尾 `\n`、时间戳单位、盐的拼接位置——这些比算法本身更常出错。
- **RSA/SM2 每次密文都不同是正常的**(含随机),别以为自己算错了;靠"能登录"验证,不靠"密文一致"。
- **拿到 token ≠ 凭证生效**:一定做最小验证(带凭证打受保护接口)。登录响应里的字段不都是凭证,有的是 UI 展示用。
- **限速/风控噪声 ≠ 密码错**:突然大面积 `429`/滑块/验证码升级是被风控了,放慢重试或暂停问用户,别误判成"账号密码不对"或"没漏洞"。
- **别把登录接口本身当越权靶子**:登录、注册、验证码接口是公开的,不适用 BAC。

## 收尾 & 授权纪律

- 每个成功身份:`upsert_project_fact(auth/<identity>, confidence=confirmed, links=[{from:target/*, type:discovered_on}])` 一条;加密链一条 `auth/login-crypto`;登录自身漏洞各 `record_vulnerability` 一条。
- **凭证是敏感物**:落库遵守项目脱敏策略与授权范围;真实密码/完整 token 按项目策略处理,summary 里可只写形态。jar 文件、下载的 JS、响应存盘一律写**会话工作目录**,收尾清理临时文件。
- 后续流程(越权/横向/接管)直接从黑板 `auth/*` 取身份复用——这正是本 skill 存在的意义:**一次登录分析,喂饱整条攻击链**。
- 授权前提:任何测试须取得书面授权,限定约定范围与时间窗口;爆破、撞库、批量登录等高风险动作前二次确认边界。
