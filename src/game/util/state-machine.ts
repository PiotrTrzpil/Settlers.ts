/**
 * Lightweight declarative state machine utility.
 *
 * Usage:
 *   const definition = defineStateMachine<MyContext>()({
 *       idle: {
 *           transitions: { start: 'working' },
 *       },
 *       working: {
 *           transitions: { done: 'idle', cancel: 'idle' },
 *           onEnter: (ctx) => ctx.unit.setAnimation('work'),
 *           onExit: (ctx) => ctx.unit.setAnimation('default'),
 *           onTick: (ctx, dt) => {
 *               ctx.progress += dt / DURATION;
 *               if (ctx.progress >= 1) return 'done';
 *           },
 *       },
 *   });
 *
 *   const sm = definition.create(initialState, { unit, progress: 0 });
 *   sm.send('start');
 *   sm.tick(dt);
 */

/** State configuration */
export interface StateConfig<TState extends string, TContext> {
    /** Valid transitions: { eventName: targetState } */
    transitions?: Partial<Record<string, TState>>;
    /** Called when entering this state */
    onEnter?: (ctx: TContext) => void;
    /** Called when exiting this state */
    onExit?: (ctx: TContext) => void;
    /** Called every tick. Return event name to auto-transition. */
    onTick?: (ctx: TContext, dt: number) => string | void;
}

/** State machine definition (reusable template) */
export interface StateMachineDefinition<TState extends string, TContext> {
    /** Create a new state machine instance */
    create(initialState: TState, context: TContext): StateMachine<TState, TContext>;
    /** Get all defined states */
    states: readonly TState[];
}

/** State machine instance */
export interface StateMachine<TState extends string, TContext> {
    /** Current state */
    readonly state: TState;
    /** Context object (mutable) */
    readonly context: TContext;
    /** Check if an event can be sent from current state */
    can(event: string): boolean;
    /** Send an event to trigger a transition. Returns true if transition occurred. */
    send(event: string): boolean;
    /** Update the state machine. Calls onTick and handles auto-transitions. */
    tick(dt: number): void;
    /** Force transition to a state (bypasses transition rules, still calls hooks) */
    forceState(state: TState): void;
}

/**
 * Define a state machine. Use curried form for type inference:
 *   defineStateMachine<MyContext>()({ ... })
 */
export function defineStateMachine<TContext>() {
    return function <TState extends string>(
        config: Record<TState, StateConfig<TState, TContext>>
    ): StateMachineDefinition<TState, TContext> {
        const states = Object.keys(config) as TState[];

        return {
            states,
            create(initialState: TState, context: TContext): StateMachine<TState, TContext> {
                let currentState = initialState;

                // Call initial state's onEnter
                config[currentState].onEnter?.(context);

                const transitionTo = (newState: TState): boolean => {
                    if (newState === currentState) return false;

                    // Exit old state
                    config[currentState].onExit?.(context);

                    // Enter new state
                    currentState = newState;
                    config[currentState].onEnter?.(context);

                    return true;
                };

                return {
                    get state() {
                        return currentState;
                    },

                    get context() {
                        return context;
                    },

                    can(event: string): boolean {
                        const transitions = config[currentState].transitions;
                        return transitions !== undefined && event in transitions;
                    },

                    send(event: string): boolean {
                        const transitions = config[currentState].transitions;
                        if (!transitions) return false;

                        const target = transitions[event];
                        if (!target) return false;

                        return transitionTo(target);
                    },

                    tick(dt: number): void {
                        const stateConfig = config[currentState];
                        if (!stateConfig.onTick) return;

                        const event = stateConfig.onTick(context, dt);
                        if (event) {
                            this.send(event);
                        }
                    },

                    forceState(state: TState): void {
                        transitionTo(state);
                    },
                };
            },
        };
    };
}
