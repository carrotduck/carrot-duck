import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

export const PORT = Number(process.env.PORT || 3002);
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
export const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || '';
export const DEEPSEEK_MODEL = 'deepseek-chat';
export const ALIYUN_API_KEY = process.env.ALIYUN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`;
export const SEARCH_API_PROVIDER = process.env.SEARCH_API_PROVIDER || 'tavily';
export const SEARCH_API_KEY = process.env.SEARCH_API_KEY || process.env.TAVILY_API_KEY || '';
export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
export const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
export const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:you@example.com';
export const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || ALIYUN_API_KEY;
export const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-v4';
export const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 256);
export const APP_VERSION = process.env.APP_VERSION || '2026.07.12-full-loop-v4';
export const PPR_POLICY_VERSION = 'ppr-outcomes-v4';
