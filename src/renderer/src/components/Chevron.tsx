/** VSCode 风格折叠箭头（chevron，展开时旋转 90°）——文件树 / 项目 / Git 分组共用 */
export default function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`dir-arrow ${open ? 'open' : ''}`} width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M6 3.5 10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
