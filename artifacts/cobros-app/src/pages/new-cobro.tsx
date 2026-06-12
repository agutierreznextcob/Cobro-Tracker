import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateCobro, getListCobrosQueryKey, getGetCobrosSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const formSchema = z.object({
  monto: z.coerce.number().min(0.01, "Amount must be greater than 0"),
  descripcion: z.string().min(1, "Description is required").max(255),
  referencia: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewCobro() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCobro = useCreateCobro();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      monto: 0,
      descripcion: "",
      referencia: "",
    },
  });

  const onSubmit = (values: FormValues) => {
    createCobro.mutate({ data: values }, {
      onSuccess: (data) => {
        toast({
          title: "Success",
          description: "Cobro created successfully.",
        });
        queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCobrosSummaryQueryKey() });
        setLocation(`/cobros/${data.id}`);
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to create cobro.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-2 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Dashboard
      </Link>
      
      <Card className="shadow-sm border-border/50">
        <CardHeader>
          <CardTitle className="text-2xl">Create New Cobro</CardTitle>
          <CardDescription>Issue a new charge to be tracked and collected.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="monto"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount (USD)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                          <Input 
                            type="number" 
                            step="0.01" 
                            placeholder="0.00" 
                            className="pl-7 font-mono" 
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="referencia"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reference (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Invoice #, PO Number..." className="font-mono text-sm" {...field} />
                      </FormControl>
                      <FormDescription>External identifier for reconciliation.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="descripcion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="What is this charge for?" 
                        className="resize-none h-24"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end pt-4 border-t border-border/50">
                <Button type="submit" disabled={createCobro.isPending} className="min-w-32">
                  {createCobro.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</>
                  ) : (
                    "Create Charge"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
