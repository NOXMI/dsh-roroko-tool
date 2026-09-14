/** 注册解析钩子:node --import ./test/helpers/register-stubs.mjs <测试文件> */
import { register } from 'node:module'

register('./stub-hooks.mjs', import.meta.url)
