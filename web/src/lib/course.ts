/**
 * The course this deployment is built around (the login subtitle names it too). Pickers
 * prefer its projects, so a student without a team lands on the lab, not on the
 * alphabetically-first project of another course.
 */
export const LAB_COURSE = 'CD252IA'

/**
 * Teammates countersign claims, for teams of any size. A solo team has nobody to do it, so a
 * claim there stays pending: it rests on its evidence and the faculty review instead.
 */
export const SOLO_TEAM_NOTE = 'Solo team: no teammate to countersign. This claim rests on its evidence and faculty review.'
