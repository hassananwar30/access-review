import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { findGuidance } from './guidance'

export const actions: Record<string, ActionHandler<Env>> = { findGuidance }
