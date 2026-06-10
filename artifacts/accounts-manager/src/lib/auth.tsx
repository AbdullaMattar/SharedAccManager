import { useGetMe } from "@workspace/api-client-react";
import { createContext, useContext, ReactNode } from "react";

type MeData = NonNullable<ReturnType<typeof useGetMe>["data"]>;

interface AuthContextType {
  user: MeData | undefined;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: undefined,
  isLoading: true,
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading, isError } = useGetMe({
    query: {
      retry: 1,
      retryDelay: 1500,
      refetchOnWindowFocus: false,
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: isLoading && !isError,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
