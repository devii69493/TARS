const KEY = 'tars_readme_profile'

export function saveProfile(text) {
  localStorage.setItem(KEY, text)
}

export function loadProfile() {
  return localStorage.getItem(KEY) || ''
}

export function clearProfile() {
  localStorage.removeItem(KEY)
}

export function buildProfileSection(profileText) {
  if (!profileText) return ''
  return `\n\nOPERATOR PROFILE (injected from README.md):\n${profileText}\n\nUse this profile to personalise responses: address the operator by name, prefer their documented contacts when composing messages, and factor in their interests and preferences. Do not summarise or repeat the profile back unless asked.`
}
