// src/game/features/inventory/pile-kind.ts

export enum SlotKind {
    Output = 'output',
    Input = 'input',
    Storage = 'storage',
    Free = 'free',
}

export type PileKind =
    | { kind: SlotKind.Output; buildingId: number }
    | { kind: SlotKind.Input; buildingId: number }
    | { kind: SlotKind.Storage; buildingId: number }
    | { kind: SlotKind.Free };

export type LinkedPileKind = Exclude<PileKind, { kind: SlotKind.Free }>;
export type LinkedSlotKind = LinkedPileKind['kind'];

export function isLinkedPile(kind: PileKind): kind is LinkedPileKind {
    return kind.kind !== SlotKind.Free;
}

export function getOwnerBuildingId(kind: PileKind): number | undefined {
    return isLinkedPile(kind) ? kind.buildingId : undefined;
}
