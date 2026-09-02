/** 解析路由路径,锚定 document.baseURI(反代带 prefix 也能命中)。 */
export function api(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  return new URL(relative, document.baseURI).pathname
}
