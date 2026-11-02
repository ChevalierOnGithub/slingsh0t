import { describe, expect, it } from 'vitest'
import { renderSegments, substitute } from './placeholders'

const v = { TARGET: '10.10.11.35', LHOST: '10.10.14.7', LPORT: '4444' }

describe('placeholders', () => {
  it('substitutes', () => {
    expect(substitute('nmap -p- {{TARGET}}', v)).toBe('nmap -p- 10.10.11.35')
    expect(substitute('nc {{LHOST}} {{LPORT}} # {{LPORT}}', v)).toBe('nc 10.10.14.7 4444 # 4444')
    expect(substitute('```bash\nping {{TARGET}}\n```', v)).toBe('```bash\nping 10.10.11.35\n```')
  })
  it('leaves empty, escaped and unknown placeholders', () => {
    expect(substitute('nmap {{TARGET}}', { TARGET: '' })).toBe('nmap {{TARGET}}')
    expect(substitute('ffuf -u http://{{DNS}}/FUZZ', { DNS: 'example.htb' })).toBe('ffuf -u http://example.htb/FUZZ')
    expect(substitute('curl {{DNS}}', {})).toBe('curl {{DNS}}')
    expect(substitute('example: \\{{TARGET}}', v)).toBe('example: {{TARGET}}')
    expect(substitute('{{FOO}} {{target}}', v)).toBe('{{FOO}} {{target}}')
  })
  it('renders segments', () => {
    expect(renderSegments('a {{TARGET}} b', v)).toEqual([{ text: 'a ' }, { text: '10.10.11.35', sub: 'TARGET' }, { text: ' b' }])
    expect(renderSegments('{{LPORT}}', {})).toEqual([{ text: '{{LPORT}}' }])
  })
})
