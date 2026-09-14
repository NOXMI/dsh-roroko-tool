/** @deepseek-ai/dsh-llm 的测试替身:只提供 preinject.js 用到的 createUserMessage。 */
export const createUserMessage = ({ content, source }) => ({ role: 'user', content, source })
