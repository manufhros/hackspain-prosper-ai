const API = "https://api.dicebear.com/9.x";

export function patientAvatarUrl(seed: string) {
  const params = new URLSearchParams({
    seed,
    backgroundColor: "b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf",
  });
  return `${API}/adventurer/svg?${params}`;
}

export function agentAvatarUrl(seed = "Marta") {
  const params = new URLSearchParams({
    seed,
    backgroundColor: "c0aede",
    radius: "50",
  });
  return `${API}/notionists/svg?${params}`;
}
