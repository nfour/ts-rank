# Tweaks

## Styled Components


Change StyledComponentBase to this to get ~50% duration reduction.

```ts
export interface StyledComponentBase<
    C extends string | React.ComponentType<any>,
    T extends object,
    O extends object = {},
    A extends keyof any = never,
    X extends StyledComponentProps<C, T, O, A> = StyledComponentProps<C, T, O, A>
> extends ForwardRefExoticBase<X> {
    // add our own fake call signature to implement the polymorphic 'as' prop
     (
        props: X
      ): React.ReactElement<X>;

}

```