/**
 * 等級配色工具
 */

export const LEVEL_COLORS = {
  經銷商: { fill: '#1E40AF', stroke: '#1E3A8A', text: '#fff' },
  高級:   { fill: '#7C3AED', stroke: '#6D28D9', text: '#fff' },
  中級:   { fill: '#0891B2', stroke: '#0E7490', text: '#fff' },
  初級:   { fill: '#059669', stroke: '#047857', text: '#fff' },
  一般:   { fill: '#6B7280', stroke: '#4B5563', text: '#fff' },
}

export const HIGH_THRESHOLD = 106 // 月均訂貨 ≥ 106萬
export const HIGHLIGHT_COLOR = '#F59E0B'
export const HIGHLIGHT_GLOW = 'rgba(245, 158, 11, 0.35)'

export function getLevelColor(level) {
  if (!level) return LEVEL_COLORS['一般']
  if (level.includes('經銷商')) return LEVEL_COLORS['經銷商']
  if (level.includes('高級')) return LEVEL_COLORS['高級']
  if (level.includes('中級')) return LEVEL_COLORS['中級']
  if (level.includes('初級')) return LEVEL_COLORS['初級']
  return LEVEL_COLORS['一般']
}

export function isHighPerformer(member) {
  return (member?.order ?? member?.amount ?? 0) >= HIGH_THRESHOLD
}

export function getLevelDotColor(level) {
  return getLevelColor(level).fill
}
