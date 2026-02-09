/**
 * BucketPriorityQueue - O(1) priority queue for A* on uniform-cost grids.
 *
 * Nodes are grouped into buckets by integer floor of their priority.
 * This is significantly faster than a binary heap when costs are mostly uniform.
 *
 * Key properties:
 * - O(1) insert
 * - Amortized O(1) extract-min
 * - FIFO within buckets (prevents systematic exploration bias)
 */
export class BucketPriorityQueue {
    private buckets: number[][] = [];
    private bucketHeads: number[] = []; // Index of next element to pop in each bucket
    private minBucket = 0;
    private _size = 0;

    get size(): number {
        return this._size;
    }

    get isEmpty(): boolean {
        return this._size === 0;
    }

    /**
     * Insert a node with given priority.
     * @param nodeId The node identifier (typically a tile index)
     * @param priority The priority/cost (lower = higher priority)
     */
    insert(nodeId: number, priority: number): void {
        const bucketIndex = Math.max(0, Math.floor(priority));

        // Ensure bucket arrays exist
        while (this.buckets.length <= bucketIndex) {
            this.buckets.push([]);
            this.bucketHeads.push(0);
        }

        this.buckets[bucketIndex].push(nodeId);

        if (bucketIndex < this.minBucket) {
            this.minBucket = bucketIndex;
        }

        this._size++;
    }

    /**
     * Remove and return the minimum-priority node.
     * @throws Error if queue is empty
     */
    popMin(): number {
        while (this.minBucket < this.buckets.length) {
            const bucket = this.buckets[this.minBucket];
            const head = this.bucketHeads[this.minBucket];

            if (head < bucket.length) {
                this._size--;
                this.bucketHeads[this.minBucket]++;
                return bucket[head];
            }

            // Bucket exhausted - clear to free memory and move on
            this.buckets[this.minBucket] = [];
            this.bucketHeads[this.minBucket] = 0;
            this.minBucket++;
        }

        throw new Error('BucketPriorityQueue is empty');
    }

    /**
     * Reset the queue for reuse.
     */
    clear(): void {
        this.buckets = [];
        this.bucketHeads = [];
        this.minBucket = 0;
        this._size = 0;
    }
}
