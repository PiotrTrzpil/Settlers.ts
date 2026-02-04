import { Node, NodeStatus, Sleep } from './behavior-tree';

/**
 * Execution context that wraps an entity and a behavior tree root node.
 * Tracks elapsed time so Sleep nodes can function correctly.
 */
export class Tick<T> {
    private readonly entity: T;
    private readonly rootNode: Node<T>;

    constructor(entity: T, rootNode: Node<T>) {
        this.entity = entity;
        this.rootNode = rootNode;
    }

    /** Run one tick of the behavior tree.
     *  @param deltaMs elapsed time since last tick in milliseconds */
    tick(deltaMs: number): NodeStatus {
        Sleep.elapsedMs = deltaMs;
        return this.rootNode.tick(this.entity);
    }
}
