import { describe, expect, it } from 'vitest'
import { servicesInText } from './services'

describe('servicesInText', () => {
  it('parser forms', () => {
    expect(servicesInText('22/tcp open ssh\n80/tcp open http Apache')).toEqual([{ name: 'ssh', port: 22 }, { name: 'http', port: 80 }])
    expect(servicesInText('22 ssh · 80 http Apache 2.4.41 · 445 smb')).toEqual([{ name: 'ssh', port: 22 }, { name: 'http', port: 80 }, { name: 'smb', port: 445 }])
    expect(servicesInText('http:80 and ldap/389')).toEqual([{ name: 'http', port: 80 }, { name: 'ldap', port: 389 }])
    expect(servicesInText('a web app and some SMB shares')).toEqual([{ name: 'smb', port: null }])
    expect(servicesInText('')).toEqual([])
  })

  it('never names tcp/udp, lowercases, collapses duplicates', () => {
    expect(servicesInText('80/tcp open http').map((s) => s.name)).not.toContain('tcp')
    expect(servicesInText('53/udp open domain')).toEqual([{ name: 'dns', port: 53 }])
    expect(servicesInText('22/TCP OPEN SSH and 22 ssh, ssh again')).toEqual([{ name: 'ssh', port: 22 }])
    expect(servicesInText('SMB here, smb there')).toEqual([{ name: 'smb', port: null }])
  })

  it('a bare word is not part of a longer name; ports stay in range', () => {
    expect(servicesInText('https and smb2')).toEqual([])
    expect(servicesInText('99999 http')).toEqual([{ name: 'http', port: null }])
  })

  it('an IP octet or the tail of a longer number is not a port', () => {
    expect(servicesInText('10.10.10.5 http')).toEqual([{ name: 'http', port: null }])
    expect(servicesInText('123456 ssh')).toEqual([{ name: 'ssh', port: null }])
    expect(servicesInText('creds work on 10.10.11.35 smb')).toEqual([{ name: 'smb', port: null }])
    expect(servicesInText('1234567/tcp open ssh')).toEqual([{ name: 'ssh', port: null }])
    expect(servicesInText('http:123456')).toEqual([{ name: 'http', port: null }])
    expect(servicesInText('22 ssh · 80 http Apache 2.4.41 · 445 smb')).toEqual([{ name: 'ssh', port: 22 }, { name: 'http', port: 80 }, { name: 'smb', port: 445 }])
  })

  it('a small count before a name is prose, not a port', () => {
    expect(servicesInText('found 3 smb shares')).toEqual([{ name: 'smb', port: null }])
    expect(servicesInText('22 ssh')).toEqual([{ name: 'ssh', port: 22 }])
  })

  it('maps nmap service names', () => {
    expect(servicesInText('445/tcp open microsoft-ds')).toEqual([{ name: 'smb', port: 445 }])
    expect(servicesInText('88/tcp open kerberos-sec')).toEqual([{ name: 'kerberos', port: 88 }])
    expect(servicesInText('5985/tcp open http')).toEqual([{ name: 'winrm', port: 5985 }])
    expect(servicesInText('80/tcp open http')).toEqual([{ name: 'http', port: 80 }])
    expect(servicesInText('443/tcp open ssl/http')).toEqual([{ name: 'http', port: 443 }])
  })

  it('maps the extra nmap names', () => {
    expect(servicesInText('135/tcp open msrpc\n6379/tcp open redis\n993/tcp open ssl/imap\n2375/tcp open docker\n623/udp open asf-rmcp'))
      .toEqual([{ name: 'rpc', port: 135 }, { name: 'redis', port: 6379 }, { name: 'imap', port: 993 }, { name: 'docker-api', port: 2375 }, { name: 'ipmi', port: 623 }])
    expect(servicesInText('user is in the docker group')).toEqual([])
  })
})
