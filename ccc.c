#include <stdio.h>

int main() {
    int T;
    long long A, B, C, hasil, D;
    scanf("%d", &T);

    while (T--) {
        scanf("%lld %lld %lld", &A, &B, &C);
        result = 1;
        base = A % C;

        while (B > 0) {
            if (B % 2 == 1) {
                result = (result * base) % C;
            }
            base = (base * base) % C;
            B /= 2;
        }

        printf("%lld\n", result);
    }

    return 0;
}