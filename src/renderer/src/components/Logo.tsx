// 应用 Logo（与 resources/logo.svg 同源）：树干 —— Timber = 木材，主干即项目，树皮纹理即记录
// animated（默认 true）启用动画：入场（约 1.2s，只播一次定格终帧）树干先自下而上“生长”
// （clipPath 裁剪矩形以底边为原点 scaleY 0→1，根脚先落地、干身升起），随后树皮纹理线、
// 枝茬、锯断面、木节、顶部断面、地面阴影 stagger 淡入；入场结束后整棵树绕树干底部中心
// 极缓慢轻摆（±0.4°，7s 一周期，克制不晃眼）。
// prefers-reduced-motion: reduce 或 animated=false 时不挂任何动画类，直接呈现静态终帧。
// 关键帧定义在 styles.css「Logo 动画（0.5.2）」段。
import type { CSSProperties } from 'react'

// 树皮纹理线（纵向深浅交替；几何/配色/线宽/透明度与 resources/logo.svg 一致，顺序即 stagger 顺序）
const BARK_LINES = [
  { d: 'M 234 150 C 231 215 229 285 227 350', stroke: '#7C4820', width: 5.5, opacity: 0.85 },
  { d: 'M 251 142 C 249 212 248 282 247 348', stroke: '#E9C08A', width: 3.2, opacity: 0.8 },
  { d: 'M 270 150 C 272 218 274 290 276 352', stroke: '#8A5227', width: 4.5, opacity: 0.8 },
  { d: 'M 288 178 C 291 235 293 295 295 342', stroke: '#D9A76A', width: 3, opacity: 0.7 },
  { d: 'M 217 235 C 214 282 212 318 211 348', stroke: '#A9713B', width: 4, opacity: 0.7 },
]

// 入场节奏（全程约 1.2s）：0s 树干开始生长（0.7s 长完）→ 0.55s 起树皮线每 70ms 淡入一条
// → 枝茬 0.7s/0.78s → 枝茬锯断面 0.86s/0.94s、木节 0.96s、地面阴影 0.9s
// → 顶部锯断面 1.0s 最后出现（此时树干刚好长到顶端）
const BARK_FIRST_DELAY_MS = 550
const BARK_STAGGER_MS = 70

// stagger 延迟经行内 animationDelay 承载：行内样式优先级高于样式表中的 animation 简写（其内置 delay 为 0）
function fadeStyle(delayMs: number): CSSProperties {
  return { animationDelay: `${delayMs}ms` }
}

export default function Logo({ size = 20, animated = true }: { size?: number; animated?: boolean }) {
  // 淡入元素统一用 timber-fade 类，只靠行内 animationDelay 区分先后
  const fade = animated ? 'timber-fade' : undefined
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-label="Timber" className={animated ? 'timber-logo' : undefined}>
      <defs>
        <linearGradient id="timber-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1C2B22" />
          <stop offset="1" stopColor="#0E1712" />
        </linearGradient>
        {/* 树干柱面体积光：横向渐变，边缘深、中间暖亮 */}
        <linearGradient id="timber-logo-trunk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7C4820" />
          <stop offset="0.28" stopColor="#A9713B" />
          <stop offset="0.52" stopColor="#D9A76A" />
          <stop offset="0.78" stopColor="#A9713B" />
          <stop offset="1" stopColor="#6E3E1D" />
        </linearGradient>
        {/* 生长裁剪：矩形包住整根树干（含根脚），动画以其底边为原点纵向展开（scaleY 0→1） */}
        <clipPath id="timber-logo-clip">
          <rect x="150" y="90" width="212" height="340" className={animated ? 'timber-grow' : undefined} />
        </clipPath>
      </defs>

      {/* 底板 */}
      <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#timber-logo-bg)" />
      {/* 地面阴影：不随树摆动，入场末尾淡入 */}
      <ellipse cx="256" cy="421" rx="110" ry="13" fill="#000000" opacity="0.28" className={fade} style={animated ? fadeStyle(900) : undefined} />

      {/* 轻摆组：入场结束后绕树干底部中心极缓慢旋转。
          注意：CSS transform 会覆盖 SVG 元素自身的 transform 属性，故本层 g 不带 transform 属性；
          带 rotate 属性的锯断面椭圆放在内层，只做透明度淡入（不涉及 CSS transform），属性得以保留 */}
      <g className={animated ? 'timber-sway' : undefined}>
        {/* 枝茬（压在树干后方，根部被遮住）：右侧一根、左上小枝 */}
        <path d="M 300 252 L 350 230" fill="none" stroke="#A9713B" strokeWidth="26" strokeLinecap="round" className={fade} style={animated ? fadeStyle(700) : undefined} />
        <path d="M 210 196 L 176 178" fill="none" stroke="#A9713B" strokeWidth="19" strokeLinecap="round" className={fade} style={animated ? fadeStyle(780) : undefined} />

        {/* 树干本体：微锥度，底部根脚外张；经 clipPath 自下而上生长 */}
        <path
          clipPath="url(#timber-logo-clip)"
          fill="url(#timber-logo-trunk)"
          d="M 212 116
            C 208 190 204 280 202 358
            C 200 384 192 400 176 412
            Q 192 418 206 406
            Q 224 422 244 408
            Q 262 422 280 406
            Q 302 418 322 408
            C 312 394 310 378 310 358
            C 308 280 304 190 300 116
            Z"
        />

        {/* 树皮纹理：纵向深浅交替，生长接近完成时逐条 stagger 淡入 */}
        <g fill="none" strokeLinecap="round">
          {BARK_LINES.map((line, i) => (
            <path
              key={line.d}
              d={line.d}
              stroke={line.stroke}
              strokeWidth={line.width}
              opacity={line.opacity}
              className={fade}
              style={animated ? fadeStyle(BARK_FIRST_DELAY_MS + i * BARK_STAGGER_MS) : undefined}
            />
          ))}
        </g>

        {/* 干身木节 */}
        <ellipse cx="260" cy="305" rx="13" ry="18" fill="none" stroke="#8A5227" strokeWidth="2.5" opacity="0.5" className={fade} style={animated ? fadeStyle(960) : undefined} />
        <ellipse cx="260" cy="305" rx="8" ry="12" fill="#7C4820" opacity="0.9" className={fade} style={animated ? fadeStyle(960) : undefined} />

        {/* 枝茬锯断面（自身带 rotate 属性，仅透明度淡入） */}
        <ellipse cx="353" cy="228" rx="8" ry="12" fill="#E9C08A" stroke="#B9834C" strokeWidth="2.5" transform="rotate(-23.7 353 228)" className={fade} style={animated ? fadeStyle(860) : undefined} />
        <ellipse cx="353" cy="228" rx="3.6" ry="6.5" fill="none" stroke="#D9A76A" strokeWidth="1.8" opacity="0.8" transform="rotate(-23.7 353 228)" className={fade} style={animated ? fadeStyle(860) : undefined} />
        <ellipse cx="174" cy="176" rx="6.5" ry="9.5" fill="#E9C08A" stroke="#B9834C" strokeWidth="2.2" transform="rotate(27.9 174 176)" className={fade} style={animated ? fadeStyle(940) : undefined} />

        {/* 顶部锯断面：一圈浅环暗示年轮，不再作为主体；最后淡入，树干刚好长到顶端 */}
        <ellipse cx="256" cy="116" rx="44" ry="16.5" fill="#E9C08A" stroke="#B9834C" strokeWidth="3" className={fade} style={animated ? fadeStyle(1000) : undefined} />
        <ellipse cx="256" cy="116" rx="26" ry="9.5" fill="none" stroke="#D9A76A" strokeWidth="2" opacity="0.75" className={fade} style={animated ? fadeStyle(1000) : undefined} />
        <ellipse cx="256" cy="116" rx="5" ry="2.2" fill="#C9894C" className={fade} style={animated ? fadeStyle(1000) : undefined} />
      </g>
    </svg>
  )
}
