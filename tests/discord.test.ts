import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readTrackerData, visibleCoords, visibleTodos } from '../electron/discord';

describe('electron/discord tracker', () => {
  let root: string;
  let dataPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lantern-discord-test-'));
    dataPath = path.join(root, 'data.json');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lee coords como array y como objeto, y todos como array', async () => {
    await writeFile(dataPath, JSON.stringify({
      coords: [{ name: 'Base', x: 1, y: 2, z: 3, dimension: 'overworld' }],
      todos: [{ text: 'Minar', done: false }]
    }), 'utf8');
    const fromArray = readTrackerData(dataPath);
    expect(fromArray.coords).toHaveLength(1);
    expect(fromArray.coords[0].name).toBe('Base');
    expect(fromArray.todos[0].text).toBe('Minar');

    await writeFile(dataPath, JSON.stringify({
      coords: { a: { name: 'Base', x: 1, y: 2, z: 3 }, b: { name: 'Mina', x: 4, y: 5, z: 6 } },
      todos: { t1: { text: 'Minar', done: true } }
    }), 'utf8');
    const fromObject = readTrackerData(dataPath);
    expect(fromObject.coords.map((coord) => coord.name).sort()).toEqual(['Base', 'Mina']);
    expect(fromObject.todos[0].done).toBe(true);
  });

  it('devuelve listas vacías si faltan coords/todos', async () => {
    await writeFile(dataPath, JSON.stringify({}), 'utf8');
    const data = readTrackerData(dataPath);
    expect(data.coords).toEqual([]);
    expect(data.todos).toEqual([]);
  });

  it('oculta entradas privadas ajenas y muestra las propias (sin distinguir mayúsculas)', () => {
    const coords = [
      { name: 'Pública', privateEntry: false },
      { name: 'Privada de Rhazerok', privateEntry: true, createdBy: 'Rhazerok' },
      { name: 'Privada de KMacking', privateEntry: true, createdBy: 'KMacking' }
    ];
    expect(visibleCoords(coords, 'rhazerok').map((coord) => coord.name)).toEqual(['Pública', 'Privada de Rhazerok']);
    expect(visibleCoords(coords, null).map((coord) => coord.name)).toEqual(['Pública']);
  });

  it('aplica la misma regla de privacidad a las tareas', () => {
    const todos = [
      { text: 'Pública', done: false },
      { text: 'Secreta', done: true, privateEntry: true, createdBy: 'KMacking' }
    ];
    expect(visibleTodos(todos, 'kmacking')).toHaveLength(2);
    expect(visibleTodos(todos, 'Rhazerok')).toHaveLength(1);
    expect(visibleTodos(todos, null)).toHaveLength(1);
  });
});
