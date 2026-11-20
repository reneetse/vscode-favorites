import * as vscode from 'vscode'
import translations from '../i18n/zh-CN.json'

export function getLanguage(): 'zh-CN' | 'en' {
  const language = vscode.workspace.getConfiguration('favorites').get<string>('language', 'zh-CN')
  return language === 'en' || (language === 'auto' && !vscode.env.language?.startsWith('zh'))
    ? 'en'
    : 'zh-CN'
}

export function t(message: string, ...args: (string | number)[]): string {
  const text = getLanguage() === 'en' ? message : (translations as Record<string, string>)[message] || message
  return text.replace(/\{(\d+)\}/g, (match, index) => String(args[Number(index)] ?? match))
}
