import { AD_TAG, type NetworkPreset } from '../shared/types'

// Public metadata only. Counts come from the cited official page; null = not confirmed there, owner fills it in.
const HTB = 'https://www.hackthebox.com/blog/interview-htb-prolabs-designer'
export const PRESETS: NetworkPreset[] = [
  { id: 'htb-dante', platform: 'HTB', name: 'Dante', hostsInScope: 14, flagsInScope: 26, source: HTB, url: 'https://app.hackthebox.com/prolabs/overview/dante', tags: [AD_TAG] },
  { id: 'htb-offshore', platform: 'HTB', name: 'Offshore', hostsInScope: 21, flagsInScope: 38, source: HTB, url: 'https://app.hackthebox.com/prolabs/overview/offshore', tags: [AD_TAG] },
  { id: 'htb-rastalabs', platform: 'HTB', name: 'RastaLabs', hostsInScope: 15, flagsInScope: 22, source: HTB, url: 'https://app.hackthebox.com/prolabs/overview/rastalabs', tags: [AD_TAG] },
  { id: 'htb-cybernetics', platform: 'HTB', name: 'Cybernetics', hostsInScope: 21, flagsInScope: 18, source: HTB, url: 'https://app.hackthebox.com/prolabs/overview/cybernetics', tags: [AD_TAG] },
  { id: 'htb-aptlabs', platform: 'HTB', name: 'APTLabs', hostsInScope: 18, flagsInScope: 20, source: HTB, url: 'https://app.hackthebox.com/prolabs/overview/aptlabs', tags: [AD_TAG] },
  { id: 'htb-zephyr', platform: 'HTB', name: 'Zephyr', hostsInScope: null, flagsInScope: null, source: 'https://www.hackthebox.com/hacker/pro-labs', url: 'https://app.hackthebox.com/prolabs/overview/zephyr', tags: [AD_TAG] },
]
