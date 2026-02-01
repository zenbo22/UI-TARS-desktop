import { AgentAppConfig } from '@tarko/agent-interface';
import dotenv from 'dotenv';
dotenv.config();

const config: AgentAppConfig = {
  model: {
    provider: process.env.VLM_PROVIDER,
    id: process.env.VLM_MODEL_NAME,
    apiKey: process.env.VLM_API_KEY,
    baseURL: process.env.VLM_BASE_URL,
  },
  server: {
    port: 8888,
  },
};

export default config;
