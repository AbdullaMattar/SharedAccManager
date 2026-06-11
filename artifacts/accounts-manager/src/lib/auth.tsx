import { useGetMe, type AuthUser } from "@workspace/api-client-react";
import { createContext, useContext, ReactNode } from "react";

interface AuthContextType {
  user: AuthUser | undefined;
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
      queryKey: ["/api/auth/me"],
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
