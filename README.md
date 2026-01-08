# AWS S3兼容API代理Worker

一个用于Cloudflare Workers的S3兼容API代理，支持七牛云、Backblaze B2等S3兼容存储服务。

## 功能特点

- ✅ 支持AWS Signature V4签名验证
- ✅ 兼容七牛云、Backblaze B2等S3兼容存储服务
- ✅ 支持path-style和virtual-host style访问
- ✅ 完整的CORS支持
- ✅ 可配置的缓存策略
- ✅ 可选的webhook通知
- ✅ 详细的错误处理和日志记录

## 部署步骤

### 1. 准备工作

```bash
# 克隆项目
git clone https://github.com/yourusername/aws-s3-proxy.git
cd aws-s3-proxy

# 或者手动创建项目目录并复制文件
mkdir aws-s3-proxy
cd aws-s3-proxy
# 复制index.js、wrangler.toml、package.json文件到这里
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
# 设置秘密环境变量（重要！）
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY

# （可选）设置webhook URL
# wrangler secret put WEBHOOK_URL
```

### 4. 配置wrangler.toml

编辑`wrangler.toml`文件，根据您使用的存储服务进行配置：

#### 七牛云配置
```toml
AWS_S3_ENDPOINT = "s3.ap-southeast-1.qiniucs.com"  # 替换为您的七牛云S3服务域名
AWS_S3_BUCKET = "your-bucket-name"                 # 替换为您的七牛云空间名
```

#### Backblaze B2配置
```toml
AWS_S3_ENDPOINT = "s3.us-west-002.backblazeb2.com"  # 替换为您的Backblaze端点
AWS_S3_BUCKET = "your-bucket-name"                  # 替换为您的Backblaze存储桶名
```

### 5. 部署Worker

```bash
# 部署到Cloudflare
wrangler publish

# 查看实时日志
wrangler tail --format=pretty
```

## 环境变量说明

| 变量名 | 说明 | 示例 |
|--------|------|------|
| **AWS_S3_ENDPOINT** | S3服务端点 | s3.ap-southeast-1.qiniucs.com |
| **AWS_ACCESS_KEY_ID** | 访问密钥ID | 您的Access Key |
| **AWS_SECRET_ACCESS_KEY** | 秘密访问密钥 | 您的Secret Key |
| **AWS_S3_BUCKET** | 存储桶/空间名称 | your-bucket-name |
| **WEBHOOK_URL** | 可选，webhook通知URL | https://your-webhook-url.com |

## 支持的存储服务

### 七牛云S3服务域名

| 存储区域 | 区域ID | S3服务域名 |
|---------|--------|------------|
| 华东-浙江 | cn-east-1 | s3.cn-east-1.qiniucs.com |
| 华东-浙江2 | cn-east-2 | s3.cn-east-2.qiniucs.com |
| 华北-河北 | cn-north-1 | s3.cn-north-1.qiniucs.com |
| 华南-广东 | cn-south-1 | s3.cn-south-1.qiniucs.com |
| 西北-陕西1 | cn-northwest-1 | s3.cn-northwest-1.qiniucs.com |
| 北美-洛杉矶 | us-north-1 | s3.us-north-1.qiniucs.com |
| 亚太-新加坡 | ap-southeast-1 | s3.ap-southeast-1.qiniucs.com |
| 亚太-河内 | ap-southeast-2 | s3.ap-southeast-2.qiniucs.com |
| 亚太-胡志明 | ap-southeast-3 | s3.ap-southeast-3.qiniucs.com |

### Backblaze B2端点

| 区域 | 端点 |
|------|------|
| 美国西部（俄勒冈） | s3.us-west-002.backblazeb2.com |
| 美国西部（加州） | s3.us-west-004.backblazeb2.com |
| 美国东部（弗吉尼亚） | s3.us-east-001.backblazeb2.com |
| 欧洲（阿姆斯特丹） | s3.eu-central-003.backblazeb2.com |
| 亚太（新加坡） | s3.ap-southeast-002.backblazeb2.com |

## 使用示例

### 1. 列出存储桶内容

```bash
curl -v https://your-worker-domain.com/ \
  -H "Authorization: AWS4-HMAC-SHA256 Credential=YOUR_ACCESS_KEY/..." \
  -H "X-Amz-Date: 20241225T120000Z"
```

### 2. 下载文件

```bash
curl -v https://your-worker-domain.com/path/to/file.txt \
  -H "Authorization: AWS4-HMAC-SHA256 Credential=YOUR_ACCESS_KEY/..." \
  -H "X-Amz-Date: 20241225T120000Z" \
  -o downloaded-file.txt
```

### 3. 上传文件

```bash
curl -X PUT -d "文件内容" https://your-worker-domain.com/new-file.txt \
  -H "Authorization: AWS4-HMAC-SHA256 Credential=YOUR_ACCESS_KEY/..." \
  -H "X-Amz-Date: 20241225T120000Z" \
  -H "Content-Type: text/plain"
```

## 安全特性

1. **签名验证**：验证传入请求的AWS V4签名
2. **头过滤**：移除不需要的Cloudflare特定头
3. **CORS支持**：完整的跨域资源共享支持
4. **错误处理**：详细的错误响应和日志记录

## 故障排除

### 常见问题

#### 1. 403 Forbidden错误
- 检查Access Key和Secret Key是否正确
- 确保X-Amz-Date格式正确（YYYYMMDD'T'HHMMSS'Z'）
- 验证存储桶名称和端点是否匹配

#### 2. 500 Internal Error
- 查看Worker日志获取详细错误信息
- 检查存储服务的状态
- 验证网络连接

#### 3. 部署失败
- 确保Node.js版本≥16
- 重新安装依赖：`npm install`
- 检查wrangler配置是否正确

### 查看日志

```bash
wrangler tail --format=pretty
```

## 性能优化

- **缓存策略**：自动缓存成功响应24小时
- **连接复用**：利用Cloudflare的连接复用
- **异步操作**：Webhook通知异步发送

## 许可证

MIT License
