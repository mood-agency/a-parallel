import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { resolve, isAbsolute } from 'path';
import { db, schema } from '../db/index.js';
import { isGitRepoSync } from '../utils/git-v2.js';
import type { Project } from '@a-parallel/shared';

export function listProjects(): Project[] {
  return db.select().from(schema.projects).all();
}

export function getProject(id: string): Project | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}

export function createProject(name: string, rawPath: string): Project {
  if (!isAbsolute(rawPath)) {
    throw new Error('Project path must be absolute');
  }
  const path = resolve(rawPath);

  if (!isGitRepoSync(path)) {
    throw new Error(`Not a git repository: ${path}`);
  }

  const existing = db.select().from(schema.projects).where(eq(schema.projects.path, path)).get();
  if (existing) {
    throw new Error(`A project with this path already exists: ${path}`);
  }

  const project: Project = {
    id: nanoid(),
    name,
    path,
    createdAt: new Date().toISOString(),
  };

  db.insert(schema.projects).values(project).run();
  return project;
}

export function deleteProject(id: string): void {
  db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
}
