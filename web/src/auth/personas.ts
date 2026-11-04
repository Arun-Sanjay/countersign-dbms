import type { AppRole } from '@/data/types'

/**
 * Demo personas (synthetic @example.edu logins created by scripts/create_personas.py).
 * Shown on the login page as one-click sign-ins; hide with VITE_SHOW_PERSONAS=false.
 */
export const DEMO_PASSWORD = 'Countersign@2026'

export interface Persona {
  key: string
  email: string
  name: string
  role: AppRole
  /** USN or faculty id */
  ref?: string
  /** What this persona demonstrates. */
  blurb: string
  tags: string[]
}

export const PERSONAS: Persona[] = [
  {
    key: 'arun',
    email: 'arun@example.edu',
    name: 'S Arun Sanjay',
    role: 'student',
    ref: '1RV24CY047',
    blurb: 'Team Countersign lead. Confirmed claims for C1 and C4; a teammate claim awaits his countersign.',
    tags: ['T00 lead'],
  },
  {
    key: 'sanvid',
    email: 'sanvid@example.edu',
    name: 'Sanvid Razdan',
    role: 'student',
    ref: '1RV24CY051',
    blurb: 'Team Countersign. Has a pending C3 claim and a private artifact only he can see.',
    tags: ['T00'],
  },
  {
    key: 'nikhil',
    email: 'nikhil@example.edu',
    name: 'Nikhil Bhat',
    role: 'student',
    ref: '1RV24CY077',
    blurb:
      'Section B, so not enrolled in the P06 lab offering: the enrollment rule keeps him out of its teams. Use the teammate finder on P01 and join Team Beta.',
    tags: ['Section B', 'no team'],
  },
  {
    key: 'meera',
    email: 'meera@example.edu',
    name: 'Meera Iyer',
    role: 'student',
    ref: '1RV24CY033',
    blurb: 'Team Sigma member with marks on C1 and C4 but no recorded evidence yet: the claim flow starts here.',
    tags: ['T06', 'no evidence yet'],
  },
  {
    key: 'ramesh',
    email: 'ramesh@example.edu',
    name: 'Dr. Ramesh Babu',
    role: 'faculty',
    ref: 'F01',
    blurb: 'Teaches CD252IA. Rubric sheet, contested queue and lab CIE marks for P06.',
    tags: ['teaches CD252IA'],
  },
  {
    key: 'lakshmi',
    email: 'lakshmi@example.edu',
    name: 'Dr. Lakshmi Prasad',
    role: 'faculty',
    ref: 'F02',
    blurb: 'Teaches AIML, not the DBMS lab: RLS hides P06 from her.',
    tags: ['other course'],
  },
  {
    key: 'admin',
    email: 'admin@example.edu',
    name: 'Administrator',
    role: 'admin',
    blurb: 'Directory and oversight across every project.',
    tags: ['all projects'],
  },
]
