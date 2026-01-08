/**
 * AWS S3兼容API代理Worker
 * 支持七牛云、Backblaze B2等S3兼容存储服务
 * 使用标准AWS环境变量命名
 */

// 使用ES模块语法导入
import { AwsClient } from 'aws4fetch';

// 从环境变量获取配置（使用标准AWS命名）
const AWS_S3_ENDPOINT = globalThis.AWS_S3_ENDPOINT;
const AWS_ACCESS_KEY_ID = globalThis.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = globalThis.AWS_SECRET_ACCESS_KEY;
const AWS_S3_BUCKET = globalThis.AWS_S3_BUCKET;
const WEBHOOK_URL = globalThis.WEBHOOK_URL;

// 验证必要的环境变量
if (!AWS_S3_ENDPOINT || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_S3_BUCKET) {
    throw new Error('缺少必要的环境变量配置');
}

// 从端点提取区域信息
const endpointRegex = /^s3\.([a-zA-Z0-9-]+)\.(qiniucs|backblazeb2)\.com$/;
const match = AWS_S3_ENDPOINT.match(endpointRegex);
if (!match) {
    throw new Error('无效的S3服务域名格式');
}
const aws_region = match[1];

// 初始化AWS客户端（兼容AWS Signature V4）
const aws = new AwsClient({
    "accessKeyId": AWS_ACCESS_KEY_ID,
    "secretAccessKey": AWS_SECRET_ACCESS_KEY,
    "service": "s3",
    "region": aws_region,
});

// Cloudflare特定头和其他不需要签名的头
const UNSIGNABLE_HEADERS = [
    'x-forwarded-proto', 'x-real-ip',
    'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 
    'cf-visitor', 'cf-request-id', 'cf-worker', 'cf-ew-via'
];

// 事件监听器
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event));
});

/**
 * 主请求处理函数
 */
async function handleRequest(event) {
    const request = event.request;
    const requestId = generateRequestId();

    try {
        console.log(`[${requestId}] 处理请求: ${request.method} ${request.url}`);

        // 处理CORS预检请求
        if (request.method === 'OPTIONS') {
            console.log(`[${requestId}] 处理CORS预检请求`);
            return handleCORS(request);
        }

        // 验证请求签名
        try {
            await verifySignature(request);
            console.log(`[${requestId}] 签名验证通过`);
        } catch (e) {
            console.error(`[${requestId}] 签名验证失败:`, e.message || e);
            return createErrorResponse(e instanceof SignatureMissingException ? 401 : 403, requestId);
        }

        // 构建目标URL
        const url = new URL(request.url);
        const targetUrl = buildTargetUrl(url);
        console.log(`[${requestId}] 目标URL: ${targetUrl}`);

        // 过滤头信息
        const headers = filterHeaders(request.headers);
        console.log(`[${requestId}] 过滤后的头数量: ${headers.length}`);

        // 重新签名请求
        const signedRequest = await aws.sign(targetUrl, {
            method: request.method,
            headers: headers,
            body: request.body
        });

        // 添加必要的头
        signedRequest.headers.set('Host', AWS_S3_ENDPOINT);
        if (!signedRequest.headers.get('X-Amz-Content-Sha256')) {
            signedRequest.headers.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD');
        }

        // 发送请求
        console.log(`[${requestId}] 发送请求到存储服务`);
        const response = await fetch(signedRequest, {
            cf: {
                cacheTtl: 3600,
                cacheTtlByStatus: {
                    "200-299": 86400,
                    "404": 1,
                    "500-599": 0
                }
            }
        });

        console.log(`[${requestId}] 存储服务响应: ${response.status} ${response.statusText}`);

        // 发送webhook通知（如果配置）
        if (WEBHOOK_URL) {
            sendWebhookNotification(event, request, response, requestId);
        }

        // 处理响应，添加CORS头
        return processResponse(response, request, requestId);

    } catch (error) {
        console.error(`[${requestId}] 处理请求错误:`, error);
        return createErrorResponse(500, requestId);
    }
}

/**
 * 生成唯一的请求ID
 */
function generateRequestId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

/**
 * 过滤不需要签名的头
 */
function filterHeaders(headers) {
    return Array.from(headers.entries())
      .filter(pair => !UNSIGNABLE_HEADERS.includes(pair[0]) && !pair[0].startsWith('cf-'));
}

/**
 * 签名异常类
 */
class SignatureMissingException extends Error {}
class SignatureInvalidException extends Error {}

/**
 * 验证传入请求的签名
 */
async function verifySignature(request) {
    const authorization = request.headers.get('Authorization');
    if (!authorization) {
        throw new SignatureMissingException();
    }

    // 解析AWS V4签名
    const re = /^AWS4-HMAC-SHA256 Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=(.+)$/;
    const match = authorization.match(re);
    if (!match) {
        throw new SignatureInvalidException();
    }

    let [ , credential, signedHeaders, signature] = match;
    credential = credential.split('/');
    signedHeaders = signedHeaders.split(';');

    // 验证访问密钥
    if (credential[0] !== AWS_ACCESS_KEY_ID) {
        throw new SignatureInvalidException();
    }

    // 获取请求时间戳
    const datetime = request.headers.get('x-amz-date');
    if (!datetime) {
        throw new SignatureInvalidException();
    }

    // 提取需要签名的头
    const headersToSign = signedHeaders
        .map(key => ({
            name: key, 
            value: request.headers.get(key) 
        }))
        .filter(item => item.value !== null)
        .reduce((obj, item) => {
            obj[item.name] = item.value;
            return obj;
        }, {});

    // 重新生成签名进行验证
    const signedRequest = await aws.sign(request.url, {
        method: request.method,
        headers: headersToSign,
        body: request.body,
        aws: { datetime: datetime, allHeaders: true }
    });

    // 比较签名
    const authHeader = signedRequest.headers.get('Authorization');
    if (!authHeader) {
        throw new SignatureInvalidException();
    }

    const authMatch = authHeader.match(re);
    if (!authMatch) {
        throw new SignatureInvalidException();
    }

    const generatedSignature = authMatch[3];
    if (signature !== generatedSignature) {
        throw new SignatureInvalidException();
    }
}

/**
 * 处理CORS请求
 */
function handleCORS(request) {
    const origin = request.headers.get('Origin') || '*';
    return new Response('', {
        headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Amz-Content-Sha256',
            'Access-Control-Max-Age': '86400',
            'Access-Control-Allow-Credentials': 'true'
        }
    });
}

/**
 * 构建目标URL
 */
function buildTargetUrl(url) {
    // 检查是否已经是virtual-host style
    if (url.hostname.endsWith('.qiniucs.com') || url.hostname.endsWith('.backblazeb2.com')) {
        return url.toString();
    }

    // 使用path-style: https://s3.region.provider.com/bucket/object
    return `https://${AWS_S3_ENDPOINT}/${AWS_S3_BUCKET}${url.pathname || '/'}${url.search || ''}`;
}

/**
 * 发送webhook通知
 */
function sendWebhookNotification(event, request, response, requestId) {
    event.waitUntil((async () => {
        try {
            const contentLength = request.headers.get('content-length');
            const notification = {
                requestId: requestId,
                timestamp: new Date().toISOString(),
                method: request.method,
                originalUrl: request.url,
                targetUrl: response.url,
                status: response.status,
                statusText: response.statusText,
                contentLength: contentLength ? parseInt(contentLength) : null,
                contentType: request.headers.get('content-type'),
                signatureTimestamp: request.headers.get('x-amz-date'),
                userAgent: request.headers.get('user-agent')
            };

            console.log(`[${requestId}] 发送webhook通知:`, JSON.stringify(notification));

            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': requestId
                },
                body: JSON.stringify(notification)
            });

        } catch (error) {
            console.error(`[${requestId}] Webhook通知失败:`, error);
        }
    })());
}

/**
 * 处理响应
 */
function processResponse(response, request, requestId) {
    const origin = request.headers.get('Origin') || '*';
    const newResponse = new Response(response.body, response);
    
    // 添加CORS头
    newResponse.headers.set('Access-Control-Allow-Origin', origin);
    newResponse.headers.set('Access-Control-Allow-Credentials', 'true');
    newResponse.headers.set('X-Request-Id', requestId);
    
    return newResponse;
}

/**
 * 创建错误响应
 */
function createErrorResponse(statusCode, requestId) {
    let errorXml;
    
    switch(statusCode) {
        case 401:
            errorXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Error>
    <Code>AccessDenied</Code>
    <Message>Unauthenticated requests are not allowed</Message>
    <RequestId>${requestId}</RequestId>
</Error>`;
            break;
        case 403:
            errorXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Error>
    <Code>SignatureDoesNotMatch</Code>
    <Message>The request signature we calculated does not match the signature you provided</Message>
    <RequestId>${requestId}</RequestId>
</Error>`;
            break;
        default:
            errorXml = `<?xml version="1.0" encoding="UTF-8"?>
<Error>
    <Code>InternalError</Code>
    <Message>An internal error occurred</Message>
    <RequestId>${requestId}</RequestId>
</Error>`;
    }
    
    return new Response(errorXml, {
        status: statusCode,
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'max-age=0, no-cache, no-store',
            'X-Request-Id': requestId
        }
    });
}

// 导出供Cloudflare Workers使用
export default { fetch: handleRequest };
