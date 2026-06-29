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

const PROFILE_CHAR_LIMIT = 600  // ≈150 tokens

export function buildProfileSection(profileText) {
  if (!profileText) return ''
  const trimmed = profileText.length > PROFILE_CHAR_LIMIT
    ? profileText.slice(0, PROFILE_CHAR_LIMIT) + '…'
    : profileText
  return `\n\nOPERATOR PROFILE:\n${trimmed}\n\nUse name, contacts, interests from above to personalise responses.`
}
