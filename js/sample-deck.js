/* =========================================================
   sample-deck.js — starter deck loaded on first run
   Demonstrates: notes with Markdown, categories, tags,
   favorites, and enough distinct answers for Quiz Mode.
   ========================================================= */

export const SAMPLE_DECK = {
  name: 'Starter: Networking & Security',
  description: 'Demo deck — ports, commands, IP ranges, procedures and policy. Edit or delete it any time.',
  cards: [
    { q: 'What port does DNS use?', a: '53', n: 'Both **TCP and UDP**. UDP for normal queries; TCP for zone transfers and responses larger than 512 bytes (or when truncated).', c: 'Ports', t: ['Networking', 'Ports'], fav: true },
    { q: 'What port does HTTPS use?', a: '443', n: 'TCP 443. HTTP/3 (QUIC) uses **UDP 443**.', c: 'Ports', t: ['Networking', 'Ports'] },
    { q: 'What port does SSH use?', a: '22', n: 'TCP 22. SFTP and SCP run over SSH, so they use 22 as well.', c: 'Ports', t: ['Networking', 'Ports', 'Security'] },
    { q: 'What port does RDP use?', a: '3389', n: 'TCP 3389 (UDP 3389 also used for performance). Never expose it directly to the internet — put it behind a VPN/ZTNA.', c: 'Ports', t: ['Networking', 'Ports', 'Microsoft'] },
    { q: 'What port does LDAPS use?', a: '636', n: 'Plain LDAP is 389. Global Catalog: 3268 (3269 over TLS).', c: 'Ports', t: ['Networking', 'Ports', 'Microsoft'] },
    { q: 'What port does Kerberos use?', a: '88', n: 'TCP and UDP 88.', c: 'Ports', t: ['Ports', 'Microsoft', 'Security'] },
    { q: 'What port does SMB use?', a: '445', n: 'TCP 445. Legacy NetBIOS uses 137–139.', c: 'Ports', t: ['Ports', 'Microsoft'] },
    { q: 'What port does Modbus TCP use?', a: '502', n: 'Common OT/ICS protocol with **no built-in authentication or encryption**.', c: 'Ports', t: ['OT', 'Ports'] },
    { q: 'What is the private IPv4 range in the 172 block?', a: '172.16.0.0/12', n: 'Covers 172.16.0.0 – 172.31.255.255 (RFC 1918).', c: 'IP Addressing', t: ['Networking'] },
    { q: 'What are the three RFC 1918 private IPv4 ranges?', a: '10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16', n: '', c: 'IP Addressing', t: ['Networking'], fav: true },
    { q: 'What address range is APIPA (link-local)?', a: '169.254.0.0/16', n: 'A Windows host that self-assigns 169.254.x.x **failed to reach DHCP** — check the cable, VLAN, or DHCP scope.', c: 'IP Addressing', t: ['Networking', 'Microsoft'] },
    { q: 'How many usable host addresses are in a /26?', a: '62', n: '2^(32−26) = 64 addresses − network − broadcast = **62**.', c: 'Subnetting', t: ['Networking'] },
    { q: 'Windows command to flush the DNS resolver cache?', a: 'ipconfig /flushdns', n: 'View the cache with `ipconfig /displaydns`.', c: 'Commands', t: ['Commands', 'Microsoft'] },
    { q: 'Windows command to show listening ports with the owning process ID?', a: 'netstat -ano', n: 'Then map PID → process:\n```\ntasklist /fi "PID eq 1234"\n```\nPowerShell: `Get-NetTCPConnection -State Listen`', c: 'Commands', t: ['Commands', 'Microsoft'] },
    { q: 'PowerShell cmdlet to test a TCP port on a remote host?', a: 'Test-NetConnection -ComputerName host -Port 443', n: 'Alias: `tnc host -Port 443`', c: 'Commands', t: ['Commands', 'Microsoft', 'Networking'] },
    { q: 'Linux command to show listening sockets and owning processes?', a: 'ss -tulpn', n: '`-t` TCP, `-u` UDP, `-l` listening, `-p` process, `-n` numeric. Older systems: `netstat -tulpn`.', c: 'Commands', t: ['Commands', 'Networking'] },
    { q: 'What are the phases of the NIST SP 800-61 incident response lifecycle?', a: 'Preparation; Detection & Analysis; Containment, Eradication & Recovery; Post-Incident Activity', n: 'Revision 3 (2025) re-maps these to the NIST CSF 2.0 functions, but the four-phase model is still widely taught.', c: 'Procedures', t: ['Security'] },
    { q: 'First step when a user reports a suspected phishing email?', a: 'Preserve and analyze it — get the original message (headers), don\'t forward it as an attachment from a clicked link', n: '1. Have the user report it with the report button\n2. Check headers (SPF/DKIM/DMARC, return-path)\n3. Detonate links/attachments in a sandbox\n4. Search & purge other mailboxes\n5. Block sender/URL, reset creds if clicked', c: 'Procedures', t: ['Security'] },
    { q: 'What does the principle of least privilege mean?', a: 'Give users and services only the minimum access needed to do their job', n: 'Pair with **just-in-time** elevation (e.g. Entra PIM) so admin rights aren\'t standing.', c: 'Policy', t: ['Security'] },
    { q: 'Which Microsoft Entra feature provides just-in-time, time-bound admin role activation?', a: 'Privileged Identity Management (PIM)', n: 'Requires Entra ID P2 (or Entra ID Governance). AZ-500 topic.', c: 'Azure', t: ['Microsoft', 'Security'] },
    { q: 'What Entra feature enforces MFA or blocks access based on user, location, device and risk?', a: 'Conditional Access', n: 'Requires Entra ID P1. Policies are **if-then**: assignments (who/what/where) → access controls (grant/block/session).', c: 'Azure', t: ['Microsoft', 'Security'] },
    { q: 'In the Purdue Model, what level is the industrial DMZ?', a: 'Level 3.5', n: 'Sits between enterprise IT (Levels 4–5) and operations/control (Levels 0–3). No direct traffic should cross IT ↔ OT without terminating in the DMZ.', c: 'OT Security', t: ['OT', 'Security'] },
    { q: 'What does the CIA triad stand for?', a: 'Confidentiality, Integrity, Availability', n: 'In OT environments the priority is often reversed: **Availability** (and safety) first.', c: 'Fundamentals', t: ['Security', 'OT'] },
    { q: 'What is the 3-2-1 backup rule?', a: '3 copies, on 2 different media, with 1 offsite', n: 'Modern variant **3-2-1-1-0**: +1 immutable/offline copy, 0 errors on restore tests.', c: 'Policy', t: ['Security'], fav: true },
    { q: 'What OSI layer do switches (non-routing) operate at?', a: 'Layer 2 — Data Link', n: 'Routers: Layer 3 (Network). A layer-3 switch does both.', c: 'Fundamentals', t: ['Networking'] },
  ],
};
