import { Node, NodeStatus } from './behavior-tree';

/**
 * Execution context that wraps an entity and a behavior tree root node.
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
        return this.rootNode.tick(this.entity, deltaMs);
    }
}
