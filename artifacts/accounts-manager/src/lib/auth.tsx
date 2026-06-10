import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { createContext, useContext, ReactNode } from "react";

interface AuthContextType {
  user: any;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useGetMe({
    query: {
      retry: false,
      refetchOnWindowFocus: false,
      queryKey: getGetMeQueryKey(),
    }
  });

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
