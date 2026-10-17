// 应用 Logo（与 resources/logo.svg 同源）：树桩年轮 —— 年轮即项目的提交历史
// animated（默认 true）启用动画：入场时髓心先淡入、年轮由内向外逐圈“生长”描画、裂纹木节最后淡入，
// 随后年轮组整体极缓慢呼吸；prefers-reduced-motion: reduce 或 animated=false 时直接呈现静态终帧。
// 关键帧定义在 styles.css 末尾「Logo 动画」段。
import type { CSSProperties } from 'react'

// 年轮参数（半径由小到大排列，即生长顺序；配色/线宽与 resources/logo.svg 一致）
const RINGS = [
  { r: 17, stroke: '#A96633', width: 2.8, opacity: 0.95 },
  { r: 29, stroke: '#C9894C', width: 1.8, opacity: 0.85 },
  { r: 40, stroke: '#A96633', width: 3.2, opacity: 0.9 },
  { r: 54, stroke: '#C9894C', width: 2, opacity: 0.8 },
  { r: 66, stroke: '#A96633', width: 3.6, opacity: 0.9 },
  { r: 81, stroke: '#C9894C', width: 2.2, opacity: 0.8 },
  { r: 93, stroke: '#A96B37', width: 4, opacity: 0.85 },
  { r: 109, stroke: '#C98F52', width: 2.4, opacity: 0.8 },
  { r: 121, stroke: '#A9713B', width: 4.4, opacity: 0.85 },
  { r: 138, stroke: '#C98F52', width: 2.6, opacity: 0.8 },
  { r: 150, stroke: '#A9713B', width: 5, opacity: 0.85 },
]

// 入场节奏：髓心 0s 淡入 → 年轮 0.1s 起每 75ms 长出一圈（单圈描画 0.3s）→ 裂纹木节 1.0s 淡入，全程约 1.2s
const RING_FIRST_DELAY_MS = 100
const RING_STAGGER_MS = 75

// 每圈年轮的描边动画参数：--timber-c 为该圆周长（≥2πr），作为 dasharray/dashoffset 初值（画满一圈）
function ringStyle(r: number, delayMs: number): CSSProperties {
  const style: CSSProperties & Record<string, string> = {
    '--timber-c': String(Math.ceil(2 * Math.PI * r)),
    animationDelay: `${delayMs}ms`,
  }
  return style
}

export default function Logo({ size = 20, animated = true }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-label="Timber" className={animated ? 'timber-logo' : undefined}>
      <defs>
        <linearGradient id="timber-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1C2B22" />
          <stop offset="1" stopColor="#0E1712" />
        </linearGradient>
        <radialGradient id="timber-logo-core" cx="0.47" cy="0.52" r="0.62">
          <stop offset="0" stopColor="#E9C08A" />
          <stop offset="0.55" stopColor="#D9A76A" />
          <stop offset="1" stopColor="#B9834C" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#timber-logo-bg)" />
      <g transform="translate(256 262) scale(1 0.965)">
        {/* 树皮 / 边材 / 心材底色：入场即就位，不参与动画 */}
        <circle r="206" fill="#4A2F1B" />
        <circle r="206" fill="none" stroke="#5C3B22" strokeWidth="6" />
        <circle r="188" fill="#E5CEA6" />
        <circle r="172" fill="url(#timber-logo-core)" />
        {/* 呼吸组：年轮 + 髓心 + 裂纹木节；入场结束后整体极缓慢缩放（注意不挂在带 transform 属性的外层 g 上，避免 CSS transform 覆盖属性） */}
        <g className={animated ? 'timber-breathe' : undefined}>
          <g fill="none" strokeLinecap="round">
            {RINGS.map((ring, i) => (
              <circle
                key={ring.r}
                r={ring.r}
                stroke={ring.stroke}
                strokeWidth={ring.width}
                opacity={ring.opacity}
                className={animated ? 'timber-ring' : undefined}
                style={animated ? ringStyle(ring.r, RING_FIRST_DELAY_MS + i * RING_STAGGER_MS) : undefined}
              />
            ))}
          </g>
          {/* 髓心：最先淡入，之后微弱脉动 */}
          <circle r="7" fill="#8A5227" className={animated ? 'timber-pith' : undefined} />
          {/* 裂纹与木节：最后淡入（keyframe 只写 from，终值回落到各自 opacity 属性） */}
          <path d="M 40 -168 L 30 -108 L 36 -62" fill="none" stroke="#7C4820" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className={animated ? 'timber-detail' : undefined} />
          <path d="M 132 118 L 86 76 L 52 58" fill="none" stroke="#7C4820" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className={animated ? 'timber-detail' : undefined} />
          <ellipse cx="-96" cy="-88" rx="20" ry="14" fill="#9C5E2E" transform="rotate(-24 -96 -88)" className={animated ? 'timber-detail' : undefined} />
          <ellipse cx="-96" cy="-88" rx="11" ry="7" fill="#7C4820" transform="rotate(-24 -96 -88)" className={animated ? 'timber-detail' : undefined} />
        </g>
      </g>
      <ellipse cx="256" cy="150" rx="150" ry="46" fill="#FFFFFF" opacity="0.06" />
    </svg>
  )
}
