import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("agent", {
  onBriefing: (callback: (data: { agentId: string; text: string; audioPath: string }) => void) =>
    ipcRenderer.on("briefing", (_event, data) => callback(data)),

  trigger: (agentId: string) =>
    ipcRenderer.invoke("trigger-agent", agentId),

  openSettings: () =>
    ipcRenderer.invoke("open-settings"),

  getSettings: () =>
    ipcRenderer.invoke("get-settings"),

  saveSettings: (data: Record<string, string>) =>
    ipcRenderer.invoke("save-settings", data),

  closeSettings: () =>
    ipcRenderer.invoke("close-settings"),

  closeApp: () =>
    ipcRenderer.invoke("close-app"),

  openMeeting: () =>
    ipcRenderer.invoke("open-meeting"),

  runDigest: () =>
    ipcRenderer.invoke("run-digest"),

  getAgents: () =>
    ipcRenderer.invoke("get-agents"),

  meetingMessage: (agentId: string, history: { role: string; content: string }[]) =>
    ipcRenderer.invoke("meeting-message", agentId, history),

  transcribeAudio: (base64: string) =>
    ipcRenderer.invoke("transcribe-audio", base64),

  closeMeeting: () =>
    ipcRenderer.invoke("close-meeting"),

  greetAgent: (agentId: string) =>
    ipcRenderer.invoke("greet-agent", agentId),
});
