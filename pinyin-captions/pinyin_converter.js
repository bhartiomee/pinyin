import { pinyin } from 'pinyin-pro';

const HTML_TAG_RE = /<\/?(font|i|b|ruby|rt|rp|span|div|br|p|c|v|lang|em|strong)[^>]*>/gi;
const ANY_TAG_RE = /<[^>]*>/g;

export function cleanChineseText(input) {
  return String(input || '')
    .replace(HTML_TAG_RE, ' ')
    .replace(ANY_TAG_RE, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function convertToPinyin(chineseText) {
  const cleaned = cleanChineseText(chineseText);

  if (!cleaned) {
    return '';
  }

  return pinyin(cleaned, {
    toneType: 'symbol',
    type: 'array',
    nonZh: 'consecutive'
  }).join(' ');
}
