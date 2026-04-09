import * as cron from 'node-cron';
import { BrowserWindow } from 'electron';
import { Agent } from '../shared/types';
import { getAgentsFromFile } from './config';
import { executeRun } from './executor';

const scheduledTasks = new Map<string, cron.ScheduledTask>();

export function initScheduler() {
  const agents = getAgentsFromFile();
  for (const agent of agents) {
    if (agent.enabled) scheduleAgent(agent);
  }
}

export function scheduleAgent(agent: Agent) {
  unscheduleAgent(agent.id);
  if (!agent.enabled || !cron.validate(agent.schedule.cron)) return;

  const task = cron.schedule(agent.schedule.cron, () => {
    const win = BrowserWindow.getAllWindows()[0] || null;
    executeRun(agent, win);
  });

  scheduledTasks.set(agent.id, task);
}

export function unscheduleAgent(agentId: string) {
  const task = scheduledTasks.get(agentId);
  if (task) {
    task.stop();
    scheduledTasks.delete(agentId);
  }
}

export function rescheduleAll() {
  for (const [id] of scheduledTasks) unscheduleAgent(id);
  initScheduler();
}

export function getNextRun(cronExpr: string): Date | null {
  // Simple next-run calculation: iterate minute by minute from now
  if (!cron.validate(cronExpr)) return null;
  // node-cron doesn't expose next run natively, so we use a basic approach
  const now = new Date();
  const parts = cronExpr.split(/\s+/);
  // Return a rough estimate — the UI can use cronstrue for display
  return null; // Will be computed client-side with cron-parser if needed
}
