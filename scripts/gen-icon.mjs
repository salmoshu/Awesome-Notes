// resources/logo.svg → build/icon.png（electron-builder 默认取 build/icon.png 生成各尺寸 ico/icns）
// 用法：node scripts/gen-icon.mjs
import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

mkdirSync('build', { recursive: true })
const svg = readFileSync('resources/logo.svg')

await sharp(svg).resize(512, 512).png().toFile('build/icon.png')
console.log('[gen-icon] build/icon.png (512x512) 已生成')
