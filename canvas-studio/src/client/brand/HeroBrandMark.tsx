/**
 * 对话区空态 Hero 的品牌标识（clapperboard logo）。
 *
 * 挂载到 dsh `conversation.hero.brand.mark` 槽（kind: 'single', scope: 'root'），
 * 把官方默认的 FishLogo 替换为 Canvas Studio 场记板。HeroShell 在空会话阶段
 * 把我们渲染在"探索未至之境"标题前（fallback 默认鱼形）。
 *
 * owner props 由 HeroShell 提供：`size`（像素方边）+ `className`（上游 css.fish，
 * 含默认颜色与 hover 动效）。className 透传给 LogoMark 并保留 csLogoMark。
 */
import type { ReactElement } from 'react'
import type { HeroBrandMarkOwnerProps } from '../slots-contracts.js'
import { LogoMark } from './LogoMark.js'

export function HeroBrandMark(props: HeroBrandMarkOwnerProps): ReactElement {
  const { size, className } = props
  return <LogoMark size={size} className={className ?? ''} />
}