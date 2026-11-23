import { Suspense } from 'react';
import MemberSignIn from '@/components/member/MemberSignIn';

// useSearchParams() (the customised link's `?i=`) needs a Suspense boundary.
export default function MemberSignInPage() {
  return (
    <Suspense fallback={null}>
      <MemberSignIn />
    </Suspense>
  );
}
