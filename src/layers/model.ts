import { Brand, orDefault, arrUpdate, arrInsert, T2, arrRemove, Case } from "../util"
import { Stack, PushArray } from "../collections"

export type Id = Brand<number, "LayerId">

export interface CollectedLayer {
    readonly id: Id
    readonly name: string
    readonly opacity: number
}

export class LeafLayer {
    static init(id: Id): LeafLayer {
        return new LeafLayer(id, "", 1, false)
    }

    private constructor(
        readonly id: Id,
        readonly name: string,
        readonly opacity: number,
        readonly isHidden: boolean
    ) {}

    get isLeaf(): true {
        return true
    }

    with(args: {
        readonly name?: string
        readonly opacity?: number
        readonly isHidden?: boolean
    }): LeafLayer {
        const name = orDefault(args.name, this.name)
        const opacity = orDefault(args.opacity, this.opacity)
        const isHidden = orDefault(args.isHidden, this.isHidden)
        return new LeafLayer(this.id, name, opacity, isHidden)
    }
}

export class GroupLayer {
    static init(id: Id): GroupLayer {
        return new GroupLayer(id, "", 1, false, [])
    }

    private constructor(
        readonly id: Id,
        readonly name: string,
        readonly opacity: number,
        readonly isHidden: boolean,
        readonly children: ReadonlyArray<Layer>
    ) {}

    get isLeaf(): false {
        return false
    }

    with(args: {
        readonly name?: string
        readonly opacity?: number
        readonly isHidden?: boolean
    }): GroupLayer {
        return new GroupLayer(
            this.id,
            orDefault(args.name, this.name),
            orDefault(args.opacity, this.opacity),
            orDefault(args.isHidden, this.isHidden),
            this.children
        )
    }

    withChildren(children: ReadonlyArray<Layer>): GroupLayer {
        return new GroupLayer(this.id, this.name, this.opacity, this.isHidden, children)
    }

    get(selectedPath: Stack.NonEmpty<number>): Layer {
        const index = selectedPath.head
        const selected = this.children[index]

        if (selectedPath.tail.isNonEmpty()) {
            if (selected.isLeaf) throw "Invariant violation"

            return selected.get(selectedPath.tail)
        }

        return selected
    }

    getWithContext(selectedPath: Stack.NonEmpty<number>, opacity: number): CollectedLayer {
        const index = selectedPath.head
        const selected = this.children[index]

        if (selectedPath.tail.isNonEmpty()) {
            if (selected.isLeaf) throw "Invariant violation"

            return selected.getWithContext(
                selectedPath.tail,
                this.isHidden ? 0 : opacity * this.opacity
            )
        }

        return {
            id: selected.id,
            name: selected.name,
            opacity: selected.isHidden ? 0 : opacity * selected.opacity,
        }
    }

    findPath(id: Id): Stack.NonEmpty<number> | null {
        const children = this.children

        for (let i = 0; i < this.children.length; i++) {
            const child = children[i]
            if (child.isLeaf) {
                if (child.id === id) return Stack.Empty.make<number>().cons(i)
            } else {
                const path = child.findPath(id)
                if (path !== null) return path.cons(i)
            }
        }

        return null
    }

    insert(selectedPath: Stack.NonEmpty<number>, leaf: LeafLayer): GroupLayer {
        const index = selectedPath.head
        const selected = this.children[index]

        if (selectedPath.tail.isNonEmpty()) {
            if (selected.isLeaf) throw "Invariant violation"

            const newSelected = selected.insert(selectedPath.tail, leaf)
            const newChildren = arrUpdate(this.children, index, newSelected)
            return this.withChildren(newChildren)
        } else {
            return this.withChildren(arrInsert(this.children, index, leaf))
        }
    }

    remove(selectedPath: Stack.NonEmpty<number>): T2<GroupLayer, Stack.Stack<number>> {
        const index = selectedPath.head
        const selected = this.children[index]

        if (selectedPath.tail.isNonEmpty()) {
            if (selected.isLeaf) throw "Invariant violation"

            const [newSelected, newSelectedPath] = selected.remove(selectedPath.tail)
            const newChildren = arrUpdate(this.children, index, newSelected)
            return [this.withChildren(newChildren), newSelectedPath.cons(index)]
        } else {
            const newChildren = this.withChildren(arrRemove(this.children, index))
            if (newChildren.children.length === 0) return [newChildren, Stack.Empty.make()]

            const newIndex = this.children.length === index + 1 ? index - 1 : index
            const newSelectedPath = index === newIndex ? selectedPath : Stack.NonEmpty.of(newIndex)
            return [newChildren, newSelectedPath]
        }
    }

    update<a extends Layer>(
        selectedPath: Stack.NonEmpty<number>,
        updateFn: (layer: a) => a
    ): GroupLayer {
        const index = selectedPath.head
        const selected = this.children[index]

        if (selectedPath.tail.isNonEmpty()) {
            if (selected.isLeaf) throw "Invariant violation"

            const newSelected = selected.update(selectedPath.tail, updateFn)
            const newChildren = arrUpdate(this.children, index, newSelected)
            return this.withChildren(newChildren)
        } else {
            const newSelected = updateFn(selected as a)
            const newChildren = arrUpdate(this.children, index, newSelected)
            return this.withChildren(newChildren)
        }
    }

    collectLeaves(array: PushArray<CollectedLayer>, opacity: number): void {
        const children = this.children
        for (let i = 0; i < children.length; i++) {
            const layer = children[i]
            const nextOpacity = layer.isHidden ? 0 : opacity * layer.opacity
            if (layer.isLeaf) {
                array.push({
                    id: layer.id,
                    name: layer.name,
                    opacity: nextOpacity,
                })
            } else {
                layer.collectLeaves(array, nextOpacity)
            }
        }
    }
}

export type Layer = LeafLayer | GroupLayer

export interface SplitLayers {
    readonly above: ReadonlyArray<CollectedLayer>
    readonly current: CollectedLayer | null
    readonly below: ReadonlyArray<CollectedLayer>
}

export enum LayersMsgType {
    NewLayer,
    Remove,
    Select,
    SetOpacity,
    SetHidden,
}

export type Msg =
    | Case<LayersMsgType.NewLayer, Id>
    | Case<LayersMsgType.Remove, Id>
    | Case<LayersMsgType.Select, Id>
    | Case<LayersMsgType.SetOpacity, T2<Id, number>>
    | Case<LayersMsgType.SetHidden, T2<Id, boolean>>

export interface MsgSender {
    newLayer(id: Id): void
    removeLayer(id: Id): void
    selectLayer(id: Id): void
    setOpacity(id: Id, opacity: number): void
    setHidden(id: Id, isHidden: boolean): void
}

export function createSender(sendMessage: (msg: Msg) => void): MsgSender {
    return {
        newLayer: id => sendMessage({ type: LayersMsgType.NewLayer, value: id }),
        removeLayer: id => sendMessage({ type: LayersMsgType.Remove, value: id }),
        selectLayer: id => sendMessage({ type: LayersMsgType.Select, value: id }),
        setOpacity: (id, opacity) =>
            sendMessage({ type: LayersMsgType.SetOpacity, value: [id, opacity] }),
        setHidden: (id, isHidden) =>
            sendMessage({ type: LayersMsgType.SetHidden, value: [id, isHidden] }),
    }
}

export class State {
    static init(): State {
        const getNextLayerId: () => Id = (() => {
            let layerId = 1
            return () => layerId++ as Id
        })()
        const leaf = LeafLayer.init(getNextLayerId())
        const group = GroupLayer.init(getNextLayerId()).withChildren([leaf])
        return new State(getNextLayerId, group, Stack.Empty.make<number>().cons(0))
    }

    private constructor(
        readonly getNextLayerId: () => Id,
        readonly layers: GroupLayer,
        readonly selectedPath: Stack.NonEmpty<number>
    ) {}

    current(): Layer {
        return this.layers.get(this.selectedPath)
    }

    update(msg: Msg): State {
        switch (msg.type) {
            case LayersMsgType.NewLayer: {
                return this.current().id === msg.value ? this.newLayer() : this
            }

            case LayersMsgType.Remove: {
                return this.current().id === msg.value ? this.removeCurrent() : this
            }

            case LayersMsgType.Select: {
                return this.current().id === msg.value ? this : this.select(msg.value)
            }

            case LayersMsgType.SetOpacity: {
                const [msgLayerId, opacity] = msg.value
                const current = this.current()

                return current.id === msgLayerId
                    ? this.updateCurrent(x => x.with({ opacity }))
                    : this
            }

            case LayersMsgType.SetHidden: {
                const [msgLayerId, isHidden] = msg.value
                const current = this.current()

                return current.id === msgLayerId
                    ? this.updateCurrent(x => x.with({ isHidden }))
                    : this
            }
        }
    }

    split(): SplitLayers {
        const children = this.layers.children
        const selectedIdx = this.selectedPath.head
        const above: PushArray<CollectedLayer> = []
        const below: PushArray<CollectedLayer> = []
        const baseOpacity: number = 1

        for (let i = 0; i < selectedIdx; i++) {
            const child = children[i]
            if (child.isLeaf)
                above.push({
                    id: child.id,
                    name: child.name,
                    opacity: baseOpacity * child.opacity,
                })
            else child.collectLeaves(above, baseOpacity)
        }

        for (let i = this.selectedPath.head + 1; i < children.length; i++) {
            const child = children[i]
            if (child.isLeaf)
                below.push({
                    id: child.id,
                    name: child.name,
                    opacity: baseOpacity * child.opacity,
                })
            else child.collectLeaves(below, baseOpacity)
        }

        const current = this.layers.get(this.selectedPath)
        if (current.isLeaf)
            return {
                above,
                current: this.layers.getWithContext(this.selectedPath, baseOpacity),
                below,
            }

        current.collectLeaves(below, baseOpacity)
        return { above, current: null, below }
    }

    private select(id: Id): State {
        const path = this.layers.findPath(id)
        if (path === null) return this

        return new State(this.getNextLayerId, this.layers, path)
    }

    private newLayer(): State {
        const layers = this.layers.insert(this.selectedPath, LeafLayer.init(this.getNextLayerId()))

        return new State(this.getNextLayerId, layers, this.selectedPath)
    }

    // newGroup(): LayerState {
    //     throw "todo"
    // }

    private removeCurrent(): State {
        const [newLayers, newSelectedPath] = this.layers.remove(this.selectedPath)

        if (newSelectedPath.isNonEmpty())
            return new State(this.getNextLayerId, newLayers, newSelectedPath)

        const oldIndex = this.selectedPath.head
        const newIndex = newLayers.children.length <= oldIndex ? oldIndex : oldIndex - 1
        return new State(this.getNextLayerId, newLayers, Stack.NonEmpty.of(newIndex))
    }

    private updateCurrent<a extends Layer>(updateFn: (layer: a) => a): State {
        return new State(
            this.getNextLayerId,
            this.layers.update(this.selectedPath, updateFn),
            this.selectedPath
        )
    }
}