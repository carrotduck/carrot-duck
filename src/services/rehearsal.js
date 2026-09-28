import { db } from '../db.js';
import { createRehearsalStore } from './rehearsalStore.js';
import { createBodyEventStore } from './bodyEventStore.js';
export const rehearsal = createRehearsalStore(db);
export const bodyEvents = createBodyEventStore(db, rehearsal);
